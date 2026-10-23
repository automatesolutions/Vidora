import { tmpdir } from "node:os"
import path from "node:path"
import { createDb, deferCheck, getGenerationJob, getRun, listModels, stepRun } from "@vidora/db"
import { createClaudeCall, createDirector } from "@vidora/director"
import { createStorage, storageEnvFrom } from "@vidora/storage"
import { Worker } from "bullmq"
import { env, tokenKeys, youtubeEnv } from "./env"
import { advanceGeneration, type EngineDeps } from "./generation-engine"
import { log } from "./log"
import { providerForCredential } from "./providers"
import { refreshModels } from "./models-refresh"
import { publishToYouTube } from "./publish"
import { createQueues, QUEUE, redisConnection, sweepGenerations, sweepRuns, bookCampaigns } from "./queues"
import { advanceRun, type RunDeps } from "./run-engine"
import { speakExpressive } from "./voice"
import { syncEngineKey } from "./engine-key"

// AutoShorts worker: drives Higgsfield generations (submit → poll → download), keeps the model
// registry fresh, books campaign slots, and takes each run from plan to a scheduled YouTube post.
const db = createDb(env.DATABASE_URL, { max: 10 })
const connection = redisConnection(env.REDIS_URL)
const queues = createQueues(connection)

// The engine's API key comes from the environment (HF_CREDENTIALS), so it's in place before any run.
await syncEngineKey(db, tokenKeys(), process.env.PLATFORM_WORKSPACE_ID || null).catch((err) => log.error("engine key sync failed", { error: String(err) }))

const storage = createStorage(storageEnvFrom(process.env))
const deps: EngineDeps = {
  db,
  storage,
  tokenKeys: tokenKeys(),
  providerFor: (credential) => providerForCredential(db, tokenKeys(), credential),
  webhook: env.WEBHOOK_SECRET ? { baseUrl: env.WEBHOOK_BASE_URL, secret: env.WEBHOOK_SECRET } : null,
}

const generationWorker = new Worker<{ id: string }>(
  QUEUE.generation,
  async (job) => {
    try {
      const row = await advanceGeneration(deps, job.data.id)
      return row ? { status: row.status } : null
    } catch (err) {
      // Unexpected crash (database blip, bug). Push the row's next check back, which also bumps its
      // version, so the sweep enqueues it again under a new job ID instead of hammering it.
      log.error("generation step crashed", { id: job.data.id, error: String(err) })
      const row = await getGenerationJob(db, job.data.id)
      if (row) await deferCheck(db, row, 60_000, `Internal error: ${String(err).slice(0, 200)}`)
      return null
    }
  },
  { connection, concurrency: env.GENERATION_CONCURRENCY }
)
generationWorker.on("failed", (job, err) => log.error("generation job failed", { id: job?.data.id, error: String(err) }))

// Runs: plan → scenes → assembly → YouTube. Planning takes a minute or two (Claude), so few at once.
const yt = youtubeEnv()
let director: ReturnType<typeof createDirector> | null = null
const runDeps: RunDeps = {
  db,
  storage: { put: storage.put, getBytes: async (key) => (await storage.get(key)).Body!.transformToByteArray() },
  tokenKeys: tokenKeys(),
  providerFor: deps.providerFor,
  director: () => (process.env.ANTHROPIC_API_KEY ? (director ??= createDirector(createClaudeCall())) : null),
  speak: (line, voice) => speakExpressive(line, voice),
  publish: (input) => publishToYouTube({ db, tokenKeys: tokenKeys(), google: yt.google, audited: yt.audited }, input),
  workRoot: path.join(tmpdir(), "autoshorts-runs"),
  platformWorkspaceId: process.env.PLATFORM_WORKSPACE_ID || null,
}
const runWorker = new Worker<{ id: string }>(
  QUEUE.runs,
  async (job) => {
    try {
      const row = await advanceRun(runDeps, job.data.id)
      return row ? { status: row.status } : null
    } catch (err) {
      // Same recovery as generations: push the next check back (bumps the version) and let the sweep retry.
      log.error("run step crashed", { id: job.data.id, error: String(err) })
      const row = await getRun(db, job.data.id)
      if (row) await stepRun(db, row, { nextCheckAt: new Date(Date.now() + 2 * 60_000), errorMessage: `Internal error: ${String(err).slice(0, 200)}` })
      return null
    }
  },
  { connection, concurrency: 2 }
)

// Maintenance: the model registry refresh, daily at 03:00 UTC (and once at startup if it's empty).
await queues.maintenance.upsertJobScheduler("refresh-models", { pattern: "0 3 * * *" }, { name: "refresh-models" })
const maintenanceWorker = new Worker(
  QUEUE.maintenance,
  async (job) => {
    if (job.name === "refresh-models") return refreshModels(db)
  },
  { connection, concurrency: 1 }
)
maintenanceWorker.on("failed", (job, err) => log.error("maintenance job failed", { name: job?.name, error: String(err) }))
if ((await listModels(db)).length === 0) await queues.maintenance.add("refresh-models", {}, { jobId: "refresh-models-startup" })

// The sweep: Postgres says what's due; this also recovers every in-flight job after a restart.
let stopping = false
let lastBooking = 0
async function sweepLoop() {
  while (!stopping) {
    try {
      await sweepGenerations(db, queues)
      await sweepRuns(db, queues)
      if (Date.now() - lastBooking > 60_000) {
        lastBooking = Date.now()
        const booked = await bookCampaigns(db)
        if (booked) log.info("runs booked", { booked })
      }
    } catch (err) {
      log.error("sweep error", { error: String(err) })
    }
    await new Promise((r) => setTimeout(r, env.SWEEP_INTERVAL_MS))
  }
}
void sweepLoop()
log.info("worker started", { director: !!process.env.ANTHROPIC_API_KEY, voice: !!process.env.ELEVENLABS_API_KEY, redis: env.REDIS_URL.replace(/\/\/.*@/, "//***@"), webhooks: !!deps.webhook?.baseUrl.startsWith("https://") })

async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info("worker stopping", { signal })
  // Let in-flight steps finish; anything cut off is picked up by the next start's sweep.
  await Promise.allSettled([generationWorker.close(), runWorker.close(), maintenanceWorker.close()])
  await Promise.allSettled([queues.generation.close(), queues.runs.close(), queues.maintenance.close()])
  await db.close()
  process.exit(0)
}
process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
