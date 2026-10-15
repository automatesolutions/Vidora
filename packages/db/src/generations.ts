import { randomUUID } from "node:crypto"
import {
  generationDeadline,
  isTerminalGeneration,
  newId,
  nextPollDelayMs,
  statusFromProvider,
  TERMINAL_GENERATION_STATUSES,
  type GenerationStatus,
  type ProviderErrorKind,
} from "@vidora/core"
import { and, asc, eq, inArray, isNull, lte, notInArray, or } from "drizzle-orm"
import type { DbOrTx } from "./client"
import { generationJobs, runs, type GenerationJob } from "./schema"
import { writeSpend } from "./spend"

// Resumable generation jobs. The row is the source of truth; each function below is one step and
// only applies when the row is still in the status that step expects (compare-and-set on status and
// version). Replaying any step after a crash is therefore harmless.
//
// Money: a hold is written when the job is created (so caps see it straight away), then exactly one
// of: charge + release (stored), or release (failed / nsfw / canceled / timed out / rejected).

export type NewGeneration = {
  workspaceId: string
  runId: string | null
  campaignId: string | null
  credentialId: string
  modelId: string
  sceneIndex?: number
  input: Record<string, unknown>
  estimate: { credits: number; usd: number }
  timeoutSec?: number
  attempt?: number
  retryOfId?: string | null
  moderationRetries?: number
}

export async function createGenerationJob(db: DbOrTx, g: NewGeneration): Promise<GenerationJob> {
  const id = newId("generation")
  const [row] = await db
    .insert(generationJobs)
    .values({
      id,
      workspaceId: g.workspaceId,
      runId: g.runId,
      credentialId: g.credentialId,
      modelId: g.modelId,
      sceneIndex: g.sceneIndex ?? 0,
      attempt: g.attempt ?? 1,
      retryOfId: g.retryOfId ?? null,
      moderationRetries: g.moderationRetries ?? 0,
      idempotencyKey: randomUUID(),
      input: g.input,
      estimateCredits: g.estimate.credits,
      estimateUsd: g.estimate.usd,
      nextCheckAt: new Date(),
      // Stored on the row so the deadline survives restarts; set properly at submit.
      deadlineAt: generationDeadline(new Date(), (g.timeoutSec ?? 1800) + 15 * 60),
    })
    .returning()
  await writeSpend(db, {
    workspaceId: g.workspaceId,
    campaignId: g.campaignId,
    runId: g.runId,
    generationJobId: id,
    kind: "hold",
    usd: g.estimate.usd,
    credits: g.estimate.credits,
    note: g.modelId,
  })
  return row!
}

export async function getGenerationJob(db: DbOrTx, id: string) {
  const [row] = await db.select().from(generationJobs).where(eq(generationJobs.id, id))
  return row ?? null
}

/** Moves a job forward only if nobody else did first. Returns the updated row, or null if it lost the race. */
async function step(db: DbOrTx, job: GenerationJob, from: GenerationStatus[], patch: Partial<typeof generationJobs.$inferInsert>) {
  const [row] = await db
    .update(generationJobs)
    .set({ ...patch, version: job.version + 1 })
    .where(and(eq(generationJobs.id, job.id), eq(generationJobs.version, job.version), inArray(generationJobs.status, from)))
    .returning()
  return row ?? null
}

async function campaignIdOf(db: DbOrTx, job: GenerationJob) {
  if (!job.runId) return null
  const [r] = await db.select({ campaignId: runs.campaignId }).from(runs).where(eq(runs.id, job.runId))
  return r?.campaignId ?? null
}

async function releaseHold(db: DbOrTx, job: GenerationJob, note: string) {
  await writeSpend(db, {
    workspaceId: job.workspaceId,
    campaignId: await campaignIdOf(db, job),
    runId: job.runId,
    generationJobId: job.id,
    kind: "release",
    usd: job.estimateUsd ?? 0,
    credits: job.estimateCredits ?? 0,
    note,
  })
}

// ── Steps ───────────────────────────────────────────────────────────────────

/** The provider accepted the request. */
export async function recordSubmitted(
  db: DbOrTx,
  job: GenerationJob,
  r: { requestId: string; statusUrl: string; cancelUrl: string | null; providerStatus: string; correlationId?: string | null; timeoutSec?: number },
  now = new Date()
) {
  // An idempotent replay can answer "queued" even when the request already finished, so the
  // acceptance receipt only ever moves us to submitted / in_progress; polling finds the rest.
  return step(db, job, ["pending"], {
    status: statusFromProvider("pending", r.providerStatus) === "in_progress" ? "in_progress" : "submitted",
    requestId: r.requestId,
    statusUrl: r.statusUrl,
    cancelUrl: r.cancelUrl,
    providerStatus: r.providerStatus,
    correlationId: r.correlationId ?? null,
    submitAttempts: job.submitAttempts + 1,
    submittedAt: job.submittedAt ?? now,
    deadlineAt: generationDeadline(job.submittedAt ?? now, r.timeoutSec),
    pollCount: 0,
    nextCheckAt: new Date(now.getTime() + nextPollDelayMs(0)),
    errorKind: null,
    errorMessage: null,
  })
}

/**
 * Submitting failed. Ambiguous or busy errors keep the job pending (same idempotency key, try again
 * later); anything else ends it and releases the hold.
 */
export async function recordSubmitError(
  db: DbOrTx,
  job: GenerationJob,
  e: { kind: ProviderErrorKind; message: string; correlationId?: string | null },
  now = new Date()
) {
  const attempts = job.submitAttempts + 1
  const transient = e.kind === "retry_same" || e.kind === "wait"
  if (transient && attempts < 8 && now < (job.deadlineAt ?? now)) {
    const delay = Math.min(10_000 * 2 ** (attempts - 1), 5 * 60_000)
    return step(db, job, ["pending"], {
      submitAttempts: attempts,
      errorKind: e.kind,
      errorMessage: e.message,
      correlationId: e.correlationId ?? job.correlationId,
      nextCheckAt: new Date(now.getTime() + delay),
    })
  }
  const row = await step(db, job, ["pending"], {
    status: "failed",
    submitAttempts: attempts,
    errorKind: e.kind,
    errorMessage: e.message,
    correlationId: e.correlationId ?? job.correlationId,
    nextCheckAt: null,
    completedAt: now,
  })
  if (row) await releaseHold(db, row, `submit ${e.kind}`)
  return row
}

/** A status read (poll or webhook). */
export async function recordProviderStatus(
  db: DbOrTx,
  job: GenerationJob,
  s: { providerStatus: string; outputUrl?: string | null; outputKind?: string | null; error?: string | null },
  now = new Date()
) {
  const next = statusFromProvider(job.status, s.providerStatus)
  const pollCount = job.pollCount + 1

  if (next === "completed") {
    if (!s.outputUrl) {
      // Completed without an output we recognise: treat as failed so it isn't charged on our side.
      const row = await step(db, job, ["submitted", "in_progress"], {
        status: "failed",
        providerStatus: s.providerStatus,
        errorKind: "invalid",
        errorMessage: "The provider finished but returned no file.",
        pollCount,
        nextCheckAt: null,
        completedAt: now,
      })
      if (row) await releaseHold(db, row, "no output")
      return row
    }
    return step(db, job, ["submitted", "in_progress"], {
      status: "completed",
      providerStatus: s.providerStatus,
      outputUrl: s.outputUrl,
      outputKind: s.outputKind ?? null,
      pollCount,
      completedAt: now,
      nextCheckAt: now, // download right away
    })
  }

  if (next === "failed" || next === "nsfw" || next === "canceled") {
    const row = await step(db, job, ["submitted", "in_progress"], {
      status: next,
      providerStatus: s.providerStatus,
      errorKind: next,
      errorMessage: s.error ?? (next === "nsfw" ? "Rejected by content moderation." : null),
      pollCount,
      nextCheckAt: null,
      completedAt: now,
    })
    if (row) await releaseHold(db, row, next)
    return row
  }

  // Still running. Past the deadline: stop waiting (Higgsfield also fails it on its side, unbilled).
  if (job.deadlineAt && now > job.deadlineAt) {
    const row = await step(db, job, ["submitted", "in_progress"], {
      status: "timed_out",
      providerStatus: s.providerStatus,
      errorKind: "timed_out",
      errorMessage: "The provider took too long.",
      pollCount,
      nextCheckAt: null,
      completedAt: now,
    })
    if (row) await releaseHold(db, row, "timed out")
    return row
  }
  return step(db, job, ["submitted", "in_progress"], {
    status: next === "pending" ? "submitted" : next,
    providerStatus: s.providerStatus,
    pollCount,
    nextCheckAt: new Date(now.getTime() + nextPollDelayMs(pollCount)),
  })
}

/** Status reads failed (network, 5xx): look again later without counting a poll. */
export async function deferCheck(db: DbOrTx, job: GenerationJob, delayMs: number, error: string, now = new Date()) {
  return step(db, job, [job.status], { nextCheckAt: new Date(now.getTime() + delayMs), errorMessage: error })
}

/** The output is in our storage. Charges the estimate and releases the hold. */
export async function recordStored(
  db: DbOrTx,
  job: GenerationJob,
  file: { storageKey: string; bytes: number; sha256: string },
  now = new Date()
) {
  const row = await step(db, job, ["completed"], { status: "stored", ...file, storedAt: now, nextCheckAt: null, errorMessage: null })
  if (row) {
    const campaignId = await campaignIdOf(db, row)
    const base = { workspaceId: row.workspaceId, campaignId, runId: row.runId, generationJobId: row.id, usd: row.estimateUsd ?? 0, credits: row.estimateCredits ?? 0 }
    await writeSpend(db, { ...base, kind: "charge", note: row.modelId })
    await writeSpend(db, { ...base, kind: "release", note: "settled" })
  }
  return row
}

/** Download failed: the provider keeps outputs for 7 days, so try again later. */
export async function recordDownloadError(db: DbOrTx, job: GenerationJob, message: string, now = new Date()) {
  const tries = job.pollCount + 1
  return step(db, job, ["completed"], {
    pollCount: tries,
    errorMessage: message,
    nextCheckAt: new Date(now.getTime() + Math.min(30_000 * 2 ** Math.min(tries, 8), 60 * 60_000)),
  })
}

/** We canceled it (only possible while the provider still has it queued). */
export async function recordCanceled(db: DbOrTx, job: GenerationJob, now = new Date()) {
  const row = await step(db, job, ["pending", "submitted"], { status: "canceled", nextCheckAt: null, completedAt: now })
  if (row) await releaseHold(db, row, "canceled")
  return row
}

/** The key was removed or rejected while jobs were in flight. */
export async function recordCredentialLost(db: DbOrTx, job: GenerationJob, message: string, now = new Date()) {
  const row = await step(db, job, ["pending", "submitted", "in_progress"], {
    status: "failed",
    errorKind: "bad_credentials",
    errorMessage: message,
    nextCheckAt: null,
    completedAt: now,
  })
  if (row) await releaseHold(db, row, "credentials")
  return row
}

/**
 * A webhook said this request finished. We don't trust the payload (Higgsfield doesn't sign it):
 * we only move the next check to now, and the worker reads the real status with the user's key.
 */
export async function expediteGenerationCheck(db: DbOrTx, id: string, requestId: string) {
  const rows = await db
    .update(generationJobs)
    .set({ nextCheckAt: new Date() })
    .where(
      and(
        eq(generationJobs.id, id),
        eq(generationJobs.requestId, requestId),
        inArray(generationJobs.status, ["submitted", "in_progress"])
      )
    )
    .returning({ id: generationJobs.id })
  return rows.length > 0
}

// ── Queries for the worker ──────────────────────────────────────────────────

/** Unfinished jobs whose next check is due (also the recovery sweep after a restart). */
export async function dueGenerationJobs(db: DbOrTx, limit = 100, now = new Date()) {
  return db
    .select()
    .from(generationJobs)
    .where(
      and(
        notInArray(generationJobs.status, [...TERMINAL_GENERATION_STATUSES]),
        or(isNull(generationJobs.nextCheckAt), lte(generationJobs.nextCheckAt, now))
      )
    )
    .orderBy(asc(generationJobs.nextCheckAt))
    .limit(limit)
}

/** Jobs of a run, newest attempt per scene. */
export async function generationJobsForRun(db: DbOrTx, runId: string) {
  return db.select().from(generationJobs).where(eq(generationJobs.runId, runId)).orderBy(asc(generationJobs.sceneIndex), asc(generationJobs.attempt))
}

export { isTerminalGeneration }
