// End-to-end check of the signed Vidora ↔ n8n round trip (Phase 0 acceptance).
// Needs: compose stack up, web app on APP_URL, worker running.  Usage: pnpm --filter @vidora/worker smoke
import { newId, signHeaders } from "@vidora/core"
import { and, applyJobEvent, asc, createDb, createJob, eq, inArray, schema, writeLedger, getBalance } from "@vidora/db"
import { env } from "./env"

const { workspaces, videoJobs, jobEvents, assets } = schema
const db = createDb(env.DATABASE_URL, { max: 2 })
let failures = 0
const check = (ok: boolean, label: string, detail?: unknown) => {
  if (!ok) failures++
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail !== undefined && !ok ? `  ${JSON.stringify(detail)}` : ""}`)
}

// 1. A forged trigger must be refused by n8n.
{
  const body = JSON.stringify({ job_id: "job_FAKE", revision: 1 })
  const res = await fetch(env.N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...signHeaders(["not-the-secret"], body) },
    body,
  })
  check(res.status === 401, "n8n rejects a trigger signed with the wrong secret", res.status)
}

// 2. A forged callback must be refused by Vidora.
{
  const res = await fetch(`${env.APP_URL}/api/webhooks/n8n`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signHeaders(["not-the-secret"], "{}") },
    body: "{}",
  })
  check(res.status === 401, "Vidora rejects a callback signed with the wrong secret", res.status)
}

// 3. Full round trip.
let [ws] = await db.select().from(workspaces).where(eq(workspaces.slug, "dev"))
if (!ws) [ws] = await db.insert(workspaces).values({ id: newId("workspace"), name: "Dev workspace", slug: "dev" }).returning()
// Cancel jobs left queued or generating by earlier smoke runs in the dev workspace (refunds their credits).
const leftovers = await db
  .select({ id: videoJobs.id })
  .from(videoJobs)
  .where(and(eq(videoJobs.workspaceId, ws!.id), inArray(videoJobs.status, ["queued", "generating"])))
for (const { id } of leftovers) {
  await db.transaction(async (tx) => {
    const [j] = await tx.select().from(videoJobs).where(eq(videoJobs.id, id)).for("update")
    if (j && j.status === "queued") await applyJobEvent(tx, j, "cancel", { type: "system" }, { payload: { reason: "smoke cleanup" } })
    if (j && j.status === "generating") await applyJobEvent(tx, j, "fail", { type: "system" }, { patch: { errorCode: "smoke_cleanup" } })
  })
}
if (leftovers.length) console.log(`cleaned up ${leftovers.length} leftover job(s)`)

await db.transaction(async (tx) => {
  if ((await getBalance(tx, ws!.id)).available < 40) await writeLedger(tx, { workspaceId: ws!.id, reason: "grant", credits: 100, note: "smoke test" })
})

const job = await createJob(db, { workspaceId: ws!.id, topic: "3 money habits", actor: { type: "system" } })
console.log(`created ${job.id}, waiting for n8n…`)

const deadline = Date.now() + 60_000
let final: schema.VideoJob | undefined = job
while (Date.now() < deadline) {
  ;[final] = await db.select().from(videoJobs).where(eq(videoJobs.id, job.id))
  if (["pending_approval", "generation_failed"].includes(final!.status)) break
  await new Promise((r) => setTimeout(r, 500))
}

check(final!.status === "pending_approval", "job reaches pending_approval", { status: final!.status, error: final!.errorMessage })
check(final!.creditsCharged === 20 && final!.creditsReserved === 0, "credits charged once (20)", { charged: final!.creditsCharged, reserved: final!.creditsReserved })
check(final!.title?.startsWith("Stub video") ?? false, "script stage data saved (title)", final!.title)
check(final!.n8nExecutionId !== null, "n8n execution recorded", final!.n8nExecutionId)

const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id)).orderBy(asc(jobEvents.createdAt))
const statusEvents = events.filter((e) => !e.event.startsWith("stage_")).map((e) => e.event)
check(statusEvents.join(",") === "create,claim,complete", "job events: create → claim → complete", statusEvents)
check(events.filter((e) => e.event === "stage_completed").length === 7, "every stage logged in job_events", events.map((e) => e.event))
const files = await db.select().from(assets).where(eq(assets.jobId, job.id))
check([...new Set(files.map((f) => f.kind))].sort().join(",") === "final_video,thumbnail", "final video and thumbnail assets saved", files.map((f) => f.kind))

// 3b. A create-video wizard job (8 s): new contract fields, short pricing, sample video and 6 cover frames.
{
  const brief = {
    creator_kind: "creator",
    video_type: "fact_tip",
    topic: "Why octopuses have three hearts",
    source_url: null,
    photo_upload_id: null,
    no_people_confirmed: false,
    look: "cinematic",
    voice: "calm",
    language: "en",
    captions_style: "bold_words",
    length_sec: 8,
    use_brand_kit: false,
  } as const
  const wiz = await createJob(db, { workspaceId: ws!.id, brief, actor: { type: "system" } })
  console.log(`created ${wiz.id} (wizard, 8 s, ${wiz.isFree ? "free" : `${wiz.creditsReserved} credits`}), waiting for n8n…`)
  const until = Date.now() + 60_000
  let row: schema.VideoJob | undefined
  while (Date.now() < until) {
    ;[row] = await db.select().from(videoJobs).where(eq(videoJobs.id, wiz.id))
    if (["pending_approval", "generation_failed"].includes(row!.status)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  check(row!.status === "pending_approval", "wizard job reaches pending_approval", { status: row!.status, error: row!.errorMessage })
  check(row!.creditsCharged === (wiz.isFree ? 0 : 6), "wizard job charged 6 credits (or free)", { charged: row!.creditsCharged, free: wiz.isFree })
  const wf = await db.select().from(assets).where(eq(assets.jobId, wiz.id))
  check(wf.find((f) => f.kind === "final_video")?.storageKey === "samples/short-8s.mp4", "8 s sample video attached", wf.map((f) => f.storageKey))
  check(wf.filter((f) => f.kind === "thumbnail").length === 6, "6 cover frame candidates attached", wf.length)
}

// 4. A crash inside n8n reaches Vidora through the vidora.error workflow and releases the credits.
{
  const crash = await createJob(db, { workspaceId: ws!.id, topic: "__smoke_crash__", actor: { type: "system" } })
  console.log(`created ${crash.id} (crash test), waiting for the error workflow…`)
  const until = Date.now() + 60_000
  let row: schema.VideoJob | undefined
  while (Date.now() < until) {
    ;[row] = await db.select().from(videoJobs).where(eq(videoJobs.id, crash.id))
    if (row!.status === "generation_failed") break
    await new Promise((r) => setTimeout(r, 500))
  }
  check(row!.status === "generation_failed" && row!.errorCode === "n8n_error", "crash is reported by the error workflow", {
    status: row!.status,
    code: row!.errorCode,
  })
  check(row!.creditsReserved === 0 && row!.creditsCharged === 0, "crashed job releases its credits", {
    reserved: row!.creditsReserved,
    charged: row!.creditsCharged,
  })
}

await db.close()
console.log(failures ? `\n${failures} check(s) failed.` : "\nRound trip OK.")
process.exit(failures ? 1 : 0)
