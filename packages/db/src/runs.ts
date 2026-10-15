import { newId, shingles, variationHash, type RunStatus, type Variation } from "@vidora/core"
import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm"
import type { DbOrTx } from "./client"
import {
  campaigns,
  notifications,
  providerCredentials,
  runEvents,
  runs,
  schedules,
  uploadLogs,
  uploads,
  variationFingerprints,
  videos,
  youtubeQuotaDays,
  type Run,
  type RunPlan,
  type Video,
} from "./schema"
import { inWorkspace } from "./scoped"

// Runs: one Short for one posting slot. Like generation jobs, every step is compare-and-set on
// status + version, and `nextCheckAt` tells the worker when to look again, so a restart resumes.
//   planned → generating → assembling → [awaiting_approval] → uploading → scheduled → published
//   (+ failed | skipped | canceled)

export const ACTIVE_RUN_STATUSES: RunStatus[] = ["generating", "assembling", "uploading", "scheduled"]

/** Runs the worker should advance now: planned runs whose generate time has come, and in-flight runs that are due. */
export async function dueRuns(db: DbOrTx, now = new Date(), limit = 50) {
  return db
    .select({ run: runs })
    .from(runs)
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(
      or(
        // Planned runs only start while the campaign is active ("run now" counts as active intent).
        and(eq(runs.status, "planned"), lte(runs.generateAt, now), or(eq(campaigns.status, "active"), eq(runs.trigger, "run_now"))),
        and(inArray(runs.status, ACTIVE_RUN_STATUSES), or(isNull(runs.nextCheckAt), lte(runs.nextCheckAt, now)))
      )
    )
    .orderBy(asc(runs.generateAt))
    .limit(limit)
    .then((rows) => rows.map((r) => r.run))
}

export async function getRun(db: DbOrTx, runId: string) {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId))
  return row ?? null
}

/** Moves a run to a new status (or updates it in place) only if nobody else did first. */
export async function stepRun(
  db: DbOrTx,
  run: Run,
  patch: Partial<typeof runs.$inferInsert>,
  event?: { name: string; actor?: "user" | "system" | "provider"; actorId?: string | null; payload?: Record<string, unknown> }
) {
  const [row] = await db
    .update(runs)
    .set({ ...patch, version: run.version + 1 })
    .where(and(eq(runs.id, run.id), eq(runs.version, run.version), eq(runs.status, run.status)))
    .returning()
  if (row && event) {
    await db.insert(runEvents).values({
      id: newId("runEvent"),
      workspaceId: run.workspaceId,
      runId: run.id,
      event: event.name,
      fromStatus: run.status,
      toStatus: row.status,
      actorType: event.actor ?? "system",
      actorId: event.actorId ?? null,
      payload: event.payload ?? {},
    })
  }
  return row ?? null
}

export async function listRunEvents(db: DbOrTx, runId: string) {
  return db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.createdAt))
}

// ── Variation history ─────────────────────────────────────────────────────────

/** Recent production choices for the variation engine (newest first). */
export async function recentVariations(db: DbOrTx, campaignId: string, limit = 30): Promise<Variation[]> {
  const rows = await db
    .select({ elements: variationFingerprints.elements })
    .from(variationFingerprints)
    .where(eq(variationFingerprints.campaignId, campaignId))
    .orderBy(desc(variationFingerprints.createdAt))
    .limit(limit)
  return rows.map((r) => r.elements)
}

/** Hooks, titles, and concepts already used, for the director agent to avoid (newest first). */
export async function campaignHistory(db: DbOrTx, campaignId: string, limit = 40) {
  const rows = await db
    .select({ plan: runs.plan })
    .from(runs)
    .where(and(eq(runs.campaignId, campaignId), inArray(runs.status, ["assembling", "awaiting_approval", "uploading", "scheduled", "published", "generating"])))
    .orderBy(desc(runs.slotAt))
    .limit(limit)
  const plans = rows.map((r) => r.plan).filter((p): p is RunPlan => !!p)
  return {
    hooks: plans.map((p) => p.hook).filter(Boolean),
    titles: plans.map((p) => p.title).filter(Boolean),
    concepts: plans.map((p) => p.concept).filter(Boolean),
  }
}

/** Saves the run's fingerprint. Returns false if this exact combination + hook was used before. */
export async function saveFingerprint(db: DbOrTx, run: Run, variation: Variation, hook: string) {
  const inserted = await db
    .insert(variationFingerprints)
    .values({
      id: newId("fingerprint"),
      workspaceId: run.workspaceId,
      campaignId: run.campaignId,
      runId: run.id,
      elements: variation,
      hash: variationHash(variation, hook),
      hook,
      hookShingles: shingles(hook),
    })
    .onConflictDoNothing()
    .returning({ id: variationFingerprints.id })
  return inserted.length > 0
}

// ── Videos ────────────────────────────────────────────────────────────────────

export async function upsertVideoForRun(db: DbOrTx, run: Run, patch: Partial<typeof videos.$inferInsert>) {
  const [row] = await db
    .insert(videos)
    .values({ id: newId("video"), workspaceId: run.workspaceId, campaignId: run.campaignId, runId: run.id, ...patch })
    .onConflictDoUpdate({ target: videos.runId, set: patch })
    .returning()
  return row!
}

export async function getVideoByRun(db: DbOrTx, runId: string) {
  const [row] = await db.select().from(videos).where(eq(videos.runId, runId))
  return row ?? null
}

export async function getVideo(db: DbOrTx, workspaceId: string, videoId: string) {
  const [row] = await db.select().from(videos).where(inWorkspace(videos, workspaceId, eq(videos.id, videoId)))
  return row ?? null
}

/** Video Library: newest first, optionally one status tab. */
export async function listVideos(db: DbOrTx, workspaceId: string, opts: { status?: Video["status"]; campaignId?: string; limit?: number } = {}) {
  return db
    .select({ video: videos, run: runs, campaignName: campaigns.name })
    .from(videos)
    .innerJoin(runs, eq(runs.id, videos.runId))
    .innerJoin(campaigns, eq(campaigns.id, videos.campaignId))
    .where(
      inWorkspace(videos, workspaceId, opts.status ? eq(videos.status, opts.status) : undefined, opts.campaignId ? eq(videos.campaignId, opts.campaignId) : undefined)
    )
    .orderBy(desc(videos.createdAt))
    .limit(opts.limit ?? 60)
}

/** Approval queue: runs waiting for a person. */
export async function listAwaitingApproval(db: DbOrTx, workspaceId: string) {
  return db
    .select({ run: runs, video: videos, campaignName: campaigns.name })
    .from(runs)
    .innerJoin(videos, eq(videos.runId, runs.id))
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .where(inWorkspace(runs, workspaceId, eq(runs.status, "awaiting_approval")))
    .orderBy(asc(runs.slotAt))
}

// ── Worker helpers ────────────────────────────────────────────────────────────

export async function getCampaignWithSchedule(db: DbOrTx, campaignId: string) {
  const [row] = await db.select({ campaign: campaigns, schedule: schedules }).from(campaigns).innerJoin(schedules, eq(schedules.campaignId, campaigns.id)).where(eq(campaigns.id, campaignId))
  return row ?? null
}

/** The credential a run generates with: the plan sign-in first, then a developer API key. */
export async function activeVideoCredential(db: DbOrTx, workspaceId: string) {
  const rows = await db
    .select()
    .from(providerCredentials)
    .where(and(eq(providerCredentials.workspaceId, workspaceId), ne(providerCredentials.status, "invalid")))
  return rows.find((r) => r.provider === "higgsfield_mcp") ?? rows.find((r) => r.provider === "higgsfield") ?? null
}

export async function readyUploads(db: DbOrTx, workspaceId: string, ids: string[]) {
  if (ids.length === 0) return []
  const rows = await db.select().from(uploads).where(inWorkspace(uploads, workspaceId, inArray(uploads.id, ids), eq(uploads.status, "ready")))
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r)
}

/** Counts a failed run against its campaign; pauses the campaign after `limit` failures in a row. */
export async function recordRunFailure(db: DbOrTx, campaignId: string, limit = 3) {
  const [c] = await db
    .update(campaigns)
    .set({ consecutiveFailures: sql`${campaigns.consecutiveFailures} + 1` })
    .where(eq(campaigns.id, campaignId))
    .returning({ failures: campaigns.consecutiveFailures, status: campaigns.status })
  if (c && c.failures >= limit && c.status === "active") {
    await db
      .update(campaigns)
      .set({ status: "paused", pauseReason: "repeated_failures", pauseMessage: `${c.failures} videos in a row didn't finish.`, pausedAt: new Date() })
      .where(eq(campaigns.id, campaignId))
    return true
  }
  return false
}

export async function recordRunSuccess(db: DbOrTx, campaignId: string) {
  await db.update(campaigns).set({ consecutiveFailures: 0, lastRunAt: new Date() }).where(eq(campaigns.id, campaignId))
}

export async function notify(db: DbOrTx, n: { workspaceId: string; type: string; payload: Record<string, unknown>; userId?: string | null }) {
  await db.insert(notifications).values({ id: newId("notification"), workspaceId: n.workspaceId, userId: n.userId ?? null, type: n.type, payload: n.payload })
}

export async function logUpload(db: DbOrTx, row: Omit<typeof uploadLogs.$inferInsert, "id">) {
  await db.insert(uploadLogs).values({ id: newId("uploadLog"), ...row })
  if (row.quotaUnits) {
    // YouTube's quota day is Pacific time.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date())
    await db
      .insert(youtubeQuotaDays)
      .values({ day, unitsUsed: row.quotaUnits })
      .onConflictDoUpdate({ target: youtubeQuotaDays.day, set: { unitsUsed: sql`${youtubeQuotaDays.unitsUsed} + ${row.quotaUnits}` } })
  }
}

export async function setVideoStatus(db: DbOrTx, runId: string, patch: Partial<typeof videos.$inferInsert>) {
  await db.update(videos).set(patch).where(eq(videos.runId, runId))
}
