import {
  CREDIT_COST,
  creditsForNewVideo,
  newId,
  shortMaxCostUsd,
  transitionJob,
  type BrandKit,
  type CallbackEvent,
  type GenerateRequest,
  type JobEvent,
  type VideoBrief,
  type VideoTier,
} from "@vidora/core"
import { and, eq, inArray, lt, or, sql, isNull } from "drizzle-orm"
import type { Db, DbOrTx, Tx } from "./client"
import { writeLedger } from "./credits"
import { assets, contentStrategies, jobEvents, providerRuns, uploads, videoJobs, webhookEvents, workspaces, type VideoJob } from "./schema"
import { inWorkspace } from "./scoped"

export type Actor = { type: "user" | "system" | "n8n"; id?: string | null }

async function lockJob(tx: Tx, jobId: string): Promise<VideoJob | undefined> {
  const [job] = await tx.select().from(videoJobs).where(eq(videoJobs.id, jobId)).for("update")
  return job
}

/** Locks a job for a creator's action. Scoped: a job from another workspace looks like it doesn't exist. */
export async function lockJobInWorkspace(tx: Tx, workspaceId: string, jobId: string): Promise<VideoJob | undefined> {
  const [job] = await tx.select().from(videoJobs).where(inWorkspace(videoJobs, workspaceId, eq(videoJobs.id, jobId))).for("update")
  return job
}

/** The list price of a job: its own base price, or the tier price for strategy-driven jobs. */
export function jobBaseCredits(job: Pick<VideoJob, "creditsBase" | "tier">) {
  return job.creditsBase > 0 ? job.creditsBase : CREDIT_COST[job.tier]
}

export class FreeVideoUnavailableError extends Error {
  constructor() {
    super("This workspace already used its free video.")
    this.name = "FreeVideoUnavailableError"
  }
}

/**
 * Creates a queued job and reserves its credits. The dispatcher picks it up from `queued`.
 * With a `brief` (create-video wizard), the price comes from the length, and the workspace's first video is free.
 */
export async function createJob(
  db: Db,
  input: {
    workspaceId: string
    strategyId?: string | null
    tier?: VideoTier
    topic?: string | null
    actor: Actor
    brief?: VideoBrief
    brandKit?: BrandKit | null
  }
) {
  return db.transaction(async (tx) => {
    const tier = input.tier ?? "short_standard"
    let credits = CREDIT_COST[tier]
    let creditsBase = credits
    let isFree = false
    if (input.brief) {
      // Lock the workspace so two tabs can't both claim the free video.
      const [ws] = await tx
        .select({ freeVideoUsedAt: workspaces.freeVideoUsedAt })
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId))
        .for("update")
      if (!ws) throw new Error(`Workspace ${input.workspaceId} not found`)
      const price = creditsForNewVideo({ lengthSec: input.brief.length_sec, freeVideoAvailable: ws.freeVideoUsedAt === null })
      ;({ credits, creditsBase, isFree } = price)
      if (isFree) await tx.update(workspaces).set({ freeVideoUsedAt: new Date() }).where(eq(workspaces.id, input.workspaceId))
    }
    const id = newId("job")
    // Insert first so the ledger row can reference the job.
    const [job] = await tx
      .insert(videoJobs)
      .values({
        id,
        workspaceId: input.workspaceId,
        strategyId: input.strategyId ?? null,
        tier,
        topic: input.brief?.topic ?? input.topic ?? null,
        brief: input.brief ?? {},
        videoType: input.brief?.video_type ?? null,
        lengthSec: input.brief?.length_sec ?? null,
        creditsBase,
        isFree,
        brandKitSnapshot: input.brief?.use_brand_kit && input.brandKit ? input.brandKit : null,
      })
      .returning()
    if (credits > 0) await writeLedger(tx, { workspaceId: input.workspaceId, reason: "reserve", credits, jobId: id })
    await tx.update(videoJobs).set({ creditsReserved: credits }).where(eq(videoJobs.id, id))
    await tx.insert(jobEvents).values({
      id: newId("jobEvent"),
      workspaceId: input.workspaceId,
      jobId: id,
      revision: 1,
      event: "create",
      toStatus: "queued",
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      payload: { credits, is_free: isFree },
    })
    return { ...job!, creditsReserved: credits }
  })
}

/**
 * Applies one state-machine event inside `tx` and runs its credit effects.
 * Returns the effects the caller still owns (dispatch, notifications, posts).
 */
export async function applyJobEvent(
  tx: Tx,
  job: VideoJob,
  event: JobEvent,
  actor: Actor,
  extra: { payload?: Record<string, unknown>; patch?: Partial<typeof videoJobs.$inferInsert>; reserveCredits?: number } = {}
) {
  const { to, effects } = transitionJob(job.status, event)
  const patch: Partial<typeof videoJobs.$inferInsert> = { ...extra.patch, status: to, lastEventAt: new Date() }
  let revision = job.revision

  for (const effect of effects) {
    if (effect === "charge_credits" && job.creditsReserved > 0) {
      await writeLedger(tx, { workspaceId: job.workspaceId, reason: "charge", credits: job.creditsReserved, jobId: job.id })
      patch.creditsCharged = job.creditsCharged + job.creditsReserved
      patch.creditsReserved = 0
    }
    if (effect === "release_credits" && job.creditsReserved > 0) {
      await writeLedger(tx, { workspaceId: job.workspaceId, reason: "release", credits: job.creditsReserved, jobId: job.id })
      patch.creditsReserved = 0
    }
    // A canceled free video that was never delivered gives the free video back.
    if (effect === "release_credits" && event === "cancel" && job.isFree && job.creditsCharged === 0 && job.revision === 1) {
      await tx.update(workspaces).set({ freeVideoUsedAt: null }).where(eq(workspaces.id, job.workspaceId))
    }
    if (effect === "reserve_credits") {
      // Retrying a failed run costs the same as the first try (nothing for the free video).
      const credits = extra.reserveCredits ?? (event === "retry" && !job.isFree ? jobBaseCredits(job) : 0)
      if (credits > 0) {
        await writeLedger(tx, { workspaceId: job.workspaceId, reason: "reserve", credits, jobId: job.id })
        patch.creditsReserved = (patch.creditsReserved ?? job.creditsReserved) + credits
      }
    }
    if (effect === "bump_revision") revision = job.revision + 1
    if (effect === "dispatch_generation") {
      patch.dispatchedAt = null
      patch.n8nExecutionId = null
      patch.progress = 0
      patch.currentStage = null
      patch.errorCode = null
      patch.errorMessage = null
    }
  }
  patch.revision = revision

  // Optimistic lock: the row must still be at the version we read.
  const updated = await tx
    .update(videoJobs)
    .set({ ...patch, version: job.version + 1 })
    .where(and(eq(videoJobs.id, job.id), eq(videoJobs.version, job.version)))
    .returning()
  if (updated.length === 0) throw new ConcurrentUpdateError(job.id)

  await tx.insert(jobEvents).values({
    id: newId("jobEvent"),
    workspaceId: job.workspaceId,
    jobId: job.id,
    revision,
    event,
    fromStatus: job.status,
    toStatus: to,
    actorType: actor.type,
    actorId: actor.id ?? null,
    payload: extra.payload ?? {},
  })
  return { job: updated[0]!, effects }
}

export class ConcurrentUpdateError extends Error {
  constructor(readonly jobId: string) {
    super(`Video ${jobId} changed while we were updating it. Reload and try again.`)
    this.name = "ConcurrentUpdateError"
  }
}

/** Takes up to `limit` queued jobs nobody has dispatched (or whose dispatch went stale) and marks them dispatched. */
export async function takeJobsToDispatch(db: Db, limit = 5, staleAfterMs = 10 * 60_000) {
  return db.transaction(async (tx) => {
    const staleBefore = new Date(Date.now() - staleAfterMs)
    const rows = await tx
      .select()
      .from(videoJobs)
      .where(and(eq(videoJobs.status, "queued"), or(isNull(videoJobs.dispatchedAt), lt(videoJobs.dispatchedAt, staleBefore))))
      .orderBy(videoJobs.createdAt)
      .limit(limit)
      .for("update", { skipLocked: true })
    if (rows.length === 0) return []
    await tx
      .update(videoJobs)
      .set({ dispatchedAt: new Date(), dispatchAttempts: sql`${videoJobs.dispatchAttempts} + 1` })
      .where(inArray(videoJobs.id, rows.map((r) => r.id)))
    return rows
  })
}

/** Builds the n8n trigger payload (docs/PLAN.md §4.2) for a job's current revision. */
export async function buildGenerateRequest(db: Db, job: VideoJob, callbackUrl: string): Promise<GenerateRequest> {
  const [strategy] = job.strategyId
    ? await db.select().from(contentStrategies).where(eq(contentStrategies.id, job.strategyId))
    : []
  const base = baseGenerateRequest(job, strategy, callbackUrl)
  const brief = job.brief as Partial<VideoBrief>
  if (!brief.video_type || !brief.length_sec) return base

  // Wizard job: pass the choices and the files (storage keys only; the provider gateway reads them from R2).
  const inputAssets: NonNullable<GenerateRequest["input_assets"]> = []
  if (brief.photo_upload_id) {
    const [photo] = await db
      .select()
      .from(uploads)
      .where(inWorkspace(uploads, job.workspaceId, eq(uploads.id, brief.photo_upload_id), eq(uploads.status, "ready")))
    if (photo) inputAssets.push({ kind: "photo", storage_key: photo.storageKey, mime: photo.mime as "image/jpeg" })
  }
  return {
    ...base,
    strategy: { ...base.strategy, language: brief.language ?? base.strategy.language, target_length_sec: brief.length_sec },
    topic: brief.topic ?? null,
    limits: { max_cost_usd: shortMaxCostUsd(brief.length_sec), max_clip_seconds: brief.length_sec },
    video_type: brief.video_type,
    look: brief.look,
    voice: brief.voice,
    captions_style: brief.captions_style,
    length_sec: brief.length_sec,
    source_url: brief.source_url ?? null,
    brand_kit: (job.brandKitSnapshot as BrandKit | null) ?? null,
    input_assets: inputAssets,
  }
}

function baseGenerateRequest(
  job: VideoJob,
  strategy: typeof contentStrategies.$inferSelect | undefined,
  callbackUrl: string
): GenerateRequest {
  return {
    job_id: job.id,
    revision: job.revision,
    workspace_id: job.workspaceId,
    rerun_from_stage: job.revision > 1 ? job.rerunFromStage : null,
    feedback: job.revision > 1 && job.feedback ? (job.feedback as GenerateRequest["feedback"]) : null,
    strategy: {
      niche: strategy?.niche ?? "general",
      audience: strategy?.audience ?? "general audience",
      tone: strategy?.tone ?? "friendly",
      language: strategy?.language ?? "en",
      format: strategy?.format ?? "short",
      target_length_sec: strategy?.targetLengthSec ?? 45,
      visual_style: strategy?.visualStyle ?? "hybrid",
    },
    topic: job.topic,
    providers: {
      llm: job.providerProfile.llm ?? "claude-sonnet-5-5",
      tts: job.providerProfile.tts ?? "elevenlabs:default",
      video: job.providerProfile.video ?? "fal:default",
      image: job.providerProfile.image ?? "fal:default",
      tier: job.tier,
    },
    limits: { max_cost_usd: job.tier === "short_premium" ? 20 : job.tier === "long_standard" ? 16 : 3, max_clip_seconds: 40 },
    reuse_assets: {},
    callback_url: callbackUrl,
  }
}

export type ClaimResult = { ok: true } | { ok: false; status: 404 | 409; reason: string }

/** n8n's first step. Only one execution may run a given revision. */
export async function claimJob(db: Db, jobId: string, revision: number, executionId: string): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const job = await lockJob(tx, jobId)
    if (!job) return { ok: false, status: 404, reason: "job_not_found" }
    if (revision !== job.revision) return { ok: false, status: 409, reason: "stale_revision" }
    if (job.status === "generating") {
      return job.n8nExecutionId === executionId ? { ok: true } : { ok: false, status: 409, reason: "already_running" }
    }
    if (job.status !== "queued") return { ok: false, status: 409, reason: `job_is_${job.status}` }
    await applyJobEvent(tx, job, "claim", { type: "n8n", id: executionId }, { patch: { n8nExecutionId: executionId } })
    return { ok: true }
  })
}

export type CallbackOutcome = "applied" | "duplicate" | "stale" | "not_found" | "ignored"

/** Applies one signed n8n callback exactly once (dedupe on event_id, stale revisions dropped). */
export async function applyCallback(db: Db, e: CallbackEvent): Promise<{ outcome: CallbackOutcome; effects: readonly string[] }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ eventId: e.event_id, source: "n8n" })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.eventId })
    if (inserted.length === 0) return { outcome: "duplicate" as const, effects: [] }

    const finish = async (outcome: CallbackOutcome, effects: readonly string[] = []) => {
      await tx.update(webhookEvents).set({ processedAt: new Date(), outcome }).where(eq(webhookEvents.eventId, e.event_id))
      return { outcome, effects }
    }

    const job = await lockJob(tx, e.job_id)
    if (!job) return finish("not_found")
    if (e.revision !== job.revision || (job.n8nExecutionId && job.n8nExecutionId !== e.execution_id)) return finish("stale")
    if (job.status !== "generating") return finish("ignored")

    for (const a of e.assets) {
      const row = {
        workspaceId: job.workspaceId,
        jobId: job.id,
        revision: e.revision,
        kind: a.kind,
        ordinal: a.ordinal,
        storageKey: a.storage_key,
        mime: a.mime,
        sha256: a.sha256,
        bytes: a.bytes,
        durationMs: a.duration_ms,
        width: a.width,
        height: a.height,
      }
      await tx
        .insert(assets)
        .values({ id: newId("asset"), ...row })
        .onConflictDoUpdate({ target: [assets.jobId, assets.revision, assets.kind, assets.ordinal], set: row })
    }

    let costUsd = job.costUsd
    for (const c of e.cost) {
      await tx.insert(providerRuns).values({
        id: newId("providerRun"),
        workspaceId: job.workspaceId,
        jobId: job.id,
        revision: e.revision,
        stage: e.stage,
        provider: c.provider,
        model: c.model,
        units: c.units,
        unit: c.unit,
        costUsd: c.usd,
      })
      costUsd += c.usd
    }

    const patch: Partial<typeof videoJobs.$inferInsert> = { costUsd, lastEventAt: new Date() }
    if (e.stage) patch.currentStage = e.stage
    if (e.progress !== undefined) patch.progress = e.progress
    if (e.data.script !== undefined) patch.script = e.data.script
    if (e.data.title !== undefined) patch.title = e.data.title
    if (e.data.caption !== undefined) patch.caption = e.data.caption
    if (e.data.hashtags !== undefined) patch.hashtags = e.data.hashtags

    const actor = { type: "n8n" as const, id: e.execution_id }
    if (e.type === "job.completed") {
      const r = await applyJobEvent(tx, job, "complete", actor, { patch: { ...patch, progress: 1 }, payload: { event_id: e.event_id } })
      return finish("applied", r.effects)
    }
    if (e.type === "job.failed") {
      const r = await applyJobEvent(tx, job, "fail", actor, {
        patch: { ...patch, errorCode: e.error!.code, errorMessage: e.error!.message },
        payload: { event_id: e.event_id, error: e.error },
      })
      return finish("applied", r.effects)
    }
    await tx.update(videoJobs).set(patch).where(eq(videoJobs.id, job.id))
    // Stage progress isn't a status change, but the progress page reads it from job_events.
    if (e.stage) {
      await tx.insert(jobEvents).values({
        id: newId("jobEvent"),
        workspaceId: job.workspaceId,
        jobId: job.id,
        revision: e.revision,
        event: e.type === "job.stage_started" ? "stage_started" : "stage_completed",
        fromStatus: job.status,
        toStatus: job.status,
        actorType: "n8n",
        actorId: e.execution_id,
        payload: { stage: e.stage, progress: e.progress ?? null, event_id: e.event_id },
      })
    }
    return finish("applied")
  })
}

/**
 * Called by n8n's error workflow, which knows only the execution ID. Fails the job that execution claimed,
 * unless it already finished or failed (then it's a no-op).
 */
export async function failJobByExecution(
  db: Db,
  executionId: string,
  error: { message: string; node?: string | null }
): Promise<"failed" | "not_found" | "ignored"> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(videoJobs).where(eq(videoJobs.n8nExecutionId, executionId)).for("update")
    if (!job) return "not_found"
    if (job.status !== "generating") return "ignored"
    await applyJobEvent(tx, job, "fail", { type: "n8n", id: executionId }, {
      patch: { errorCode: "n8n_error", errorMessage: error.message.slice(0, 500) },
      payload: { node: error.node ?? null, message: error.message.slice(0, 2000) },
    })
    return "failed"
  })
}
