import { and, applyJobEvent, eq, gte, lt, or, schema, type Db } from "@vidora/db"
import { log } from "./log"

const { videoJobs } = schema

// A job is stuck when n8n has said nothing for this long (docs/PLAN.md §4.6).
const STUCK_AFTER_MS = { short: 30 * 60_000, long: 120 * 60_000 }
const MAX_DISPATCH_ATTEMPTS = 5

/** Fails jobs that n8n stopped reporting on, or that n8n never accepted, and releases their credits. */
export async function reconcileStuckJobs(db: Db) {
  const now = Date.now()
  const candidates = await db
    .select({ id: videoJobs.id })
    .from(videoJobs)
    .where(
      or(
        and(eq(videoJobs.status, "generating"), lt(videoJobs.lastEventAt, new Date(now - STUCK_AFTER_MS.short))),
        and(eq(videoJobs.status, "queued"), gte(videoJobs.dispatchAttempts, MAX_DISPATCH_ATTEMPTS))
      )
    )
    .limit(50)

  let failed = 0
  for (const { id } of candidates) {
    await db.transaction(async (tx) => {
      const [job] = await tx.select().from(videoJobs).where(eq(videoJobs.id, id)).for("update", { skipLocked: true })
      if (!job) return
      const limit = job.tier === "long_standard" ? STUCK_AFTER_MS.long : STUCK_AFTER_MS.short
      const stuck = job.status === "generating" && now - job.lastEventAt.getTime() > limit
      const undeliverable = job.status === "queued" && job.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS
      if (!stuck && !undeliverable) return
      const code = stuck ? "stuck_timeout" : "dispatch_failed"
      await applyJobEvent(tx, job, "fail", { type: "system" }, {
        patch: { errorCode: code, errorMessage: stuck ? "The video stopped making progress." : "We couldn't start this video." },
        payload: { code },
      })
      failed++
      log.warn("failed stuck job", { jobId: job.id, code })
    })
  }
  return failed
}
