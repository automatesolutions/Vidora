import { createDb } from "@vidora/db"
import { PgBoss } from "pg-boss"
import { dispatchQueuedJobs } from "./dispatch"
import { env } from "./env"
import { log } from "./log"
import { reconcileStuckJobs } from "./reconcile"

// Vidora worker: dispatches generation to n8n and runs scheduled maintenance.
// Phase 1 adds: publish-post, refresh-tokens, send-notifications queues.
const db = createDb(env.DATABASE_URL, { max: 5 })
const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" })
boss.on("error", (err) => log.error("pg-boss error", { error: String(err) }))

await boss.start()
await boss.createQueue("reconcile-stuck-jobs")
await boss.schedule("reconcile-stuck-jobs", "*/5 * * * *")
await boss.work("reconcile-stuck-jobs", async () => {
  const failed = await reconcileStuckJobs(db)
  if (failed) log.info("reconcile finished", { failed })
})

let stopping = false
async function dispatchLoop() {
  while (!stopping) {
    try {
      await dispatchQueuedJobs(db)
    } catch (err) {
      log.error("dispatch loop error", { error: String(err) })
    }
    await new Promise((r) => setTimeout(r, env.DISPATCH_INTERVAL_MS))
  }
}
void dispatchLoop()
log.info("worker started", { n8n: env.N8N_WEBHOOK_URL, app: env.APP_URL })

async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info("worker stopping", { signal })
  await boss.stop({ graceful: true, timeout: 20_000 })
  await db.close()
  process.exit(0)
}
process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
