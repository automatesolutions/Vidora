import { activeCampaigns, bookUpcomingRuns, dueGenerationJobs, dueRuns, type Db } from "@vidora/db"
import { Queue, type ConnectionOptions } from "bullmq"

// BullMQ queues. Redis only carries "look at row X (version V)" messages; Postgres holds the state.
// If Redis is wiped, the sweep below re-enqueues everything that's due, so nothing is lost.

export const QUEUE = {
  generation: "generation",
  runs: "runs",
  maintenance: "maintenance",
} as const

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ workers
  }
}

export function createQueues(connection: ConnectionOptions) {
  const defaults = { removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } }
  return {
    // Finished generation messages are removed at once so their IDs are free: retries are decided by the
    // row (nextCheckAt), never by BullMQ, and a kept failed ID would block the sweep from re-adding it.
    generation: new Queue<{ id: string }>(QUEUE.generation, { connection, defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 } }),
    runs: new Queue<{ id: string }>(QUEUE.runs, { connection, defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 } }),
    maintenance: new Queue(QUEUE.maintenance, { connection, defaultJobOptions: defaults }),
  }
}
export type Queues = ReturnType<typeof createQueues>

/**
 * Enqueues every unfinished generation whose next check is due. The BullMQ job ID includes the row
 * version, so a row is processed once per step even if the sweep sees it twice.
 */
export async function sweepGenerations(db: Db, queues: Queues, now = new Date()) {
  const due = await dueGenerationJobs(db, 200, now)
  if (due.length === 0) return 0
  await queues.generation.addBulk(due.map((g) => ({ name: "advance", data: { id: g.id }, opts: { jobId: `${g.id}.v${g.version}` } })))
  return due.length
}

/** Runs due now (same pattern as generations: the job ID carries the row version). */
export async function sweepRuns(db: Db, queues: Queues, now = new Date()) {
  const due = await dueRuns(db, now, 50)
  if (due.length === 0) return 0
  await queues.runs.addBulk(due.map((r) => ({ name: "advance", data: { id: r.id }, opts: { jobId: `${r.id}.v${r.version}` } })))
  return due.length
}

/** Books the next three posting slots of every active campaign. Idempotent. */
export async function bookCampaigns(db: Db, now = new Date()) {
  let booked = 0
  for (const c of await activeCampaigns(db)) booked += await bookUpcomingRuns(db, c, now, 3)
  return booked
}
