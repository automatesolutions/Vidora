import { GenerateAcceptedSchema, IDEMPOTENCY_HEADER, signHeaders } from "@vidora/core"
import { buildGenerateRequest, takeJobsToDispatch, type Db } from "@vidora/db"
import { env } from "./env"
import { log } from "./log"

/**
 * Sends queued jobs to n8n. The `queued` status is the outbox: a job stays queued until n8n claims it,
 * so a crash between "take" and "send" only delays the job until the dispatch goes stale (10 min).
 */
export async function dispatchQueuedJobs(db: Db) {
  const jobs = await takeJobsToDispatch(db, 5)
  for (const job of jobs) {
    const payload = await buildGenerateRequest(db, job, `${env.APP_URL}/api/webhooks/n8n`)
    // n8n verifies the HMAC over JSON.stringify(body), so always send exactly this string.
    const body = JSON.stringify(payload)
    try {
      const res = await fetch(env.N8N_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [IDEMPOTENCY_HEADER]: `${job.id}:${job.revision}`,
          ...signHeaders(env.VIDORA_TO_N8N_SECRETS, body),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      })
      const json = await res.json().catch(() => null)
      const accepted = GenerateAcceptedSchema.safeParse(json)
      if (res.status !== 202 || !accepted.success) {
        log.warn("n8n did not accept the job", { jobId: job.id, status: res.status, body: json })
        continue
      }
      log.info("dispatched", { jobId: job.id, revision: job.revision, execution: accepted.data.execution_id })
    } catch (err) {
      log.warn("n8n unreachable, will retry when the dispatch goes stale", { jobId: job.id, error: String(err) })
    }
  }
  return jobs.length
}
