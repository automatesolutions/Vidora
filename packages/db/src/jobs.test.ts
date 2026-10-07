// Integration tests against a real Postgres. Run with TEST_DATABASE_URL set (compose `dev` profile):
//   TEST_DATABASE_URL=postgres://vidora:vidora@localhost:5433/vidora pnpm --filter @vidora/db test
import { newId, type CallbackEvent } from "@vidora/core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDb, type Db } from "./client"
import { getBalance } from "./credits"
import { applyCallback, applyJobEvent, claimJob, createJob, failJobByExecution, takeJobsToDispatch } from "./jobs"
import { creditLedger, jobEvents, videoJobs, workspaces } from "./schema"

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

suite("job lifecycle (Postgres)", () => {
  let db: Db
  let workspaceId: string

  beforeAll(async () => {
    db = createDb(url, { max: 4 })
    workspaceId = newId("workspace")
    await db.insert(workspaces).values({ id: workspaceId, name: "Test", slug: workspaceId.toLowerCase() })
    await db.transaction(async (tx) => {
      const { writeLedger } = await import("./credits")
      await writeLedger(tx, { workspaceId, reason: "grant", credits: 100 })
    })
  })

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId)) // cascades to jobs, ledger, events
    await db.close()
  })

  const balance = () => db.transaction((tx) => getBalance(tx, workspaceId))
  const ev = (job: { id: string }, type: CallbackEvent["type"], extra: Partial<CallbackEvent> = {}): CallbackEvent => ({
    event_id: newId("jobEvent"),
    type,
    job_id: job.id,
    revision: 1,
    execution_id: "exec-1",
    stage: null,
    assets: [],
    data: {},
    cost: [],
    error: null,
    ...extra,
  })

  it("reserves credits on create and charges them when the video is ready", async () => {
    const job = await createJob(db, { workspaceId, actor: { type: "system" } })
    expect(await balance()).toEqual({ available: 80, reserved: 20 })

    expect(await claimJob(db, job.id, 1, "exec-1")).toEqual({ ok: true })
    expect(await claimJob(db, job.id, 1, "exec-1")).toEqual({ ok: true }) // same execution retrying is fine
    expect(await claimJob(db, job.id, 1, "exec-2")).toMatchObject({ ok: false, status: 409, reason: "already_running" })
    expect(await claimJob(db, job.id, 2, "exec-1")).toMatchObject({ ok: false, reason: "stale_revision" })

    const stage = ev(job, "job.stage_completed", {
      stage: "script",
      progress: 0.3,
      data: { title: "3 money habits", hashtags: ["#money"] },
      cost: [{ provider: "anthropic", units: 1200, unit: "tokens", usd: 0.02 }],
    })
    expect((await applyCallback(db, stage)).outcome).toBe("applied")
    expect((await applyCallback(db, stage)).outcome).toBe("duplicate")
    expect((await applyCallback(db, { ...ev(job, "job.stage_completed"), revision: 0 })).outcome).toBe("stale")
    expect((await applyCallback(db, { ...ev(job, "job.stage_completed"), execution_id: "exec-9" })).outcome).toBe("stale")

    const done = await applyCallback(
      db,
      ev(job, "job.completed", {
        stage: "render",
        assets: [{ kind: "final_video", ordinal: 0, storage_key: `${workspaceId}/${job.id}/r1/final.mp4`, mime: "video/mp4" }],
        cost: [{ provider: "fal", units: 40, unit: "seconds", usd: 1.5 }],
      })
    )
    expect(done.outcome).toBe("applied")
    expect(done.effects).toContain("notify_review")

    const [after] = await db.select().from(videoJobs).where(eq(videoJobs.id, job.id))
    expect(after).toMatchObject({ status: "pending_approval", title: "3 money habits", creditsReserved: 0, creditsCharged: 20, progress: 1 })
    expect(after!.costUsd).toBeCloseTo(1.52)
    expect(await balance()).toEqual({ available: 80, reserved: 0 })

    const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id))
    expect(events.map((e) => e.event).sort()).toEqual(["claim", "complete", "create"])
  })

  it("releases credits when generation fails", async () => {
    const job = await createJob(db, { workspaceId, actor: { type: "system" } })
    await claimJob(db, job.id, 1, "exec-1")
    const r = await applyCallback(db, ev(job, "job.failed", { error: { code: "provider_timeout", message: "Video model timed out", retryable: true } }))
    expect(r.outcome).toBe("applied")
    const [after] = await db.select().from(videoJobs).where(eq(videoJobs.id, job.id))
    expect(after).toMatchObject({ status: "generation_failed", errorCode: "provider_timeout", creditsReserved: 0 })
    expect(await balance()).toEqual({ available: 80, reserved: 0 })
  })

  it("starts a new revision when changes are requested", async () => {
    const job = await createJob(db, { workspaceId, actor: { type: "system" } })
    await claimJob(db, job.id, 1, "exec-1")
    await applyCallback(db, ev(job, "job.completed"))
    await db.transaction(async (tx) => {
      const [j] = await tx.select().from(videoJobs).where(eq(videoJobs.id, job.id)).for("update")
      const r1 = await applyJobEvent(tx, j!, "request_changes", { type: "user", id: null })
      await applyJobEvent(tx, r1.job, "requeue", { type: "system" }, { patch: { rerunFromStage: "voiceover" } })
    })
    const [after] = await db.select().from(videoJobs).where(eq(videoJobs.id, job.id))
    expect(after).toMatchObject({ status: "queued", revision: 2, rerunFromStage: "voiceover", dispatchedAt: null })
    // Old revision callbacks no longer apply
    expect((await applyCallback(db, ev(job, "job.completed"))).outcome).toBe("stale")
  })

  it("fails the job an n8n execution claimed when that execution crashes", async () => {
    const job = await createJob(db, { workspaceId, actor: { type: "system" } })
    await claimJob(db, job.id, 1, "exec-crash")
    expect(await failJobByExecution(db, "exec-unknown", { message: "boom" })).toBe("not_found")
    expect(await failJobByExecution(db, "exec-crash", { message: "Node 'Run stub pipeline' failed", node: "Run stub pipeline" })).toBe("failed")
    expect(await failJobByExecution(db, "exec-crash", { message: "again" })).toBe("ignored") // already failed
    const [after] = await db.select().from(videoJobs).where(eq(videoJobs.id, job.id))
    expect(after).toMatchObject({ status: "generation_failed", errorCode: "n8n_error", creditsReserved: 0 })
  })

  it("refuses to create a job without enough credits", async () => {
    await expect(createJob(db, { workspaceId, tier: "long_standard", actor: { type: "system" } })).rejects.toThrow(/needs 150 credits/)
    const jobs = await db.select().from(videoJobs).where(eq(videoJobs.workspaceId, workspaceId))
    expect(jobs.every((j) => j.tier !== "long_standard")).toBe(true) // the insert rolled back
  })

  it("hands each queued job to one dispatcher only", async () => {
    await createJob(db, { workspaceId, actor: { type: "system" } })
    const [a, b] = await Promise.all([takeJobsToDispatch(db, 10), takeJobsToDispatch(db, 10)])
    const ids = [...a, ...b].map((j) => j.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(1)
    const ledger = await db.select().from(creditLedger).where(eq(creditLedger.workspaceId, workspaceId))
    expect(ledger.at(-1)).toBeDefined()
  })
})
