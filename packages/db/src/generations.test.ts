// Integration tests against a real Postgres. Run with TEST_DATABASE_URL set (compose `dev` profile):
//   TEST_DATABASE_URL=postgres://vidora:vidora@localhost:5433/vidora_test pnpm --filter @vidora/db test
import { newId, tokenKeysFromEnv } from "@vidora/core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDb, type Db } from "./client"
import { parseHiggsfieldKey, readProviderSecret, saveProviderCredential } from "./credentials"
import {
  createGenerationJob,
  dueGenerationJobs,
  getGenerationJob,
  recordDownloadError,
  recordProviderStatus,
  recordStored,
  recordSubmitError,
  recordSubmitted,
} from "./generations"
import { campaigns, runs, spendLedger, workspaces } from "./schema"
import { campaignSpend } from "./spend"

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const keys = tokenKeysFromEnv("1:" + "c".repeat(64))
const RID = () => crypto.randomUUID()

suite("generation jobs (Postgres)", () => {
  let db: Db
  let workspaceId: string
  let campaignId: string
  let runId: string
  let credentialId: string

  beforeAll(async () => {
    db = createDb(url, { max: 4 })
    workspaceId = newId("workspace")
    campaignId = newId("campaign")
    runId = newId("run")
    await db.insert(workspaces).values({ id: workspaceId, name: "Test", slug: workspaceId.toLowerCase() })
    await db.insert(campaigns).values({ id: campaignId, workspaceId, name: "Daily motivation", brief: { topic: "daily motivation" } })
    await db.insert(runs).values({ id: runId, workspaceId, campaignId, slotAt: new Date(Date.now() + 86_400_000), generateAt: new Date() })
    credentialId = (await saveProviderCredential(db, keys, workspaceId, "kid_1234:sec_abcd_long")).id
  })

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId)) // cascades
    await db.close()
  })

  const newJob = () =>
    createGenerationJob(db, {
      workspaceId,
      runId,
      campaignId,
      credentialId,
      modelId: "kling-video/v3.0/std/text-to-video",
      input: { prompt: "sunrise", aspect_ratio: "9:16" },
      estimate: { credits: 12.5, usd: 0.78 },
    })
  const ledger = async (jobId: string) =>
    (await db.select().from(spendLedger).where(eq(spendLedger.generationJobId, jobId))).map((r) => r.kind).sort()

  it("stores the key encrypted and reads it back", async () => {
    const { getProviderCredential } = await import("./credentials")
    const c = (await getProviderCredential(db, workspaceId))!
    expect(c.secretEnc).not.toContain("sec_abcd")
    expect(c.keyHint).toBe("long")
    expect(readProviderSecret(c, keys)).toBe("kid_1234:sec_abcd_long")
    expect(() => parseHiggsfieldKey("kumpooniapp@gmail.com")).toThrow(/email/)
    expect(() => parseHiggsfieldKey("3e09abcd0a2f3e09:")).toThrow(/cut off/)
    expect(() => parseHiggsfieldKey("short")).toThrow(/too short/)
    expect(parseHiggsfieldKey("Key 3e09abcd:secret0a2fsecret")).toEqual({ credentials: "3e09abcd:secret0a2fsecret", hint: "cret" })
    expect(parseHiggsfieldKey("3e09abcdef0123456789abcdef0a2f").hint).toBe("0a2f") // single-token keys are accepted too
  })

  it("runs pending → submitted → in_progress → completed → stored, charging exactly once", async () => {
    let job = await newJob()
    expect(job.status).toBe("pending")
    expect(job.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(await ledger(job.id)).toEqual(["hold"])
    expect((await campaignSpend(db, campaignId, new Date(0))).heldUsd).toBeGreaterThanOrEqual(0.78)

    const requestId = RID()
    job = (await recordSubmitted(db, job, { requestId, statusUrl: "https://api.higgsfield.ai/s", cancelUrl: null, providerStatus: "queued" }))!
    expect(job.status).toBe("submitted")
    expect(job.nextCheckAt!.getTime()).toBeGreaterThan(Date.now())

    job = (await recordProviderStatus(db, job, { providerStatus: "in_progress" }))!
    expect(job.status).toBe("in_progress")
    job = (await recordProviderStatus(db, job, { providerStatus: "completed", outputUrl: "https://cdn/x.mp4", outputKind: "video" }))!
    expect(job.status).toBe("completed")

    const stored = (await recordStored(db, job, { storageKey: `${workspaceId}/gen/${job.id}.mp4`, bytes: 1234, sha256: "ab" }))!
    expect(stored.status).toBe("stored")
    // Replaying the same step (crash after the update, before the ack) changes nothing.
    expect(await recordStored(db, job, { storageKey: "other", bytes: 1, sha256: "x" })).toBeNull()
    expect(await ledger(job.id)).toEqual(["charge", "hold", "release"])
  })

  it("ignores a stale step from a worker that lost the race", async () => {
    const job = await newJob()
    const first = await recordSubmitted(db, job, { requestId: RID(), statusUrl: "https://api.higgsfield.ai/s", cancelUrl: null, providerStatus: "queued" })
    expect(first).not.toBeNull()
    // Second worker still holds the old row (version 0): its write must not apply.
    expect(await recordSubmitted(db, job, { requestId: RID(), statusUrl: "https://api.higgsfield.ai/s2", cancelUrl: null, providerStatus: "queued" })).toBeNull()
    expect((await getGenerationJob(db, job.id))!.requestId).toBe(first!.requestId)
  })

  it("keeps an ambiguous submit pending with the same idempotency key", async () => {
    const job = await newJob()
    const after = (await recordSubmitError(db, job, { kind: "retry_same", message: "timeout" }))!
    expect(after.status).toBe("pending")
    expect(after.idempotencyKey).toBe(job.idempotencyKey)
    expect(after.submitAttempts).toBe(1)
    expect(after.nextCheckAt!.getTime()).toBeGreaterThan(Date.now())
    expect(await ledger(job.id)).toEqual(["hold"])
  })

  it("fails a rejected submit and releases the hold", async () => {
    const job = await newJob()
    const after = (await recordSubmitError(db, job, { kind: "no_credits", message: "Not enough credits" }))!
    expect(after.status).toBe("failed")
    expect(after.errorKind).toBe("no_credits")
    expect(await ledger(job.id)).toEqual(["hold", "release"])
  })

  it("releases the hold on nsfw and failed (Higgsfield doesn't bill them)", async () => {
    for (const status of ["nsfw", "failed"] as const) {
      let job = await newJob()
      job = (await recordSubmitted(db, job, { requestId: RID(), statusUrl: "https://api.higgsfield.ai/s", cancelUrl: null, providerStatus: "queued" }))!
      job = (await recordProviderStatus(db, job, { providerStatus: status, error: status === "failed" ? "Generation failed" : null }))!
      expect(job.status).toBe(status)
      expect(job.nextCheckAt).toBeNull()
      expect(await ledger(job.id)).toEqual(["hold", "release"])
    }
  })

  it("times out a job past its deadline", async () => {
    let job = await newJob()
    job = (await recordSubmitted(db, job, { requestId: RID(), statusUrl: "https://api.higgsfield.ai/s", cancelUrl: null, providerStatus: "queued", timeoutSec: 60 }))!
    const later = new Date(job.submittedAt!.getTime() + 61_000)
    job = (await recordProviderStatus(db, job, { providerStatus: "in_progress" }, later))!
    expect(job.status).toBe("timed_out")
    expect(await ledger(job.id)).toEqual(["hold", "release"])
  })

  it("retries a failed download later and keeps it completed", async () => {
    let job = await newJob()
    job = (await recordSubmitted(db, job, { requestId: RID(), statusUrl: "https://api.higgsfield.ai/s", cancelUrl: null, providerStatus: "queued" }))!
    job = (await recordProviderStatus(db, job, { providerStatus: "completed", outputUrl: "https://cdn/y.mp4" }))!
    job = (await recordDownloadError(db, job, "HTTP 502"))!
    expect(job.status).toBe("completed")
    expect(job.nextCheckAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it("lists unfinished jobs that are due (the restart recovery sweep)", async () => {
    const job = await newJob()
    const due = await dueGenerationJobs(db, 500)
    expect(due.some((j) => j.id === job.id)).toBe(true)
    expect(due.every((j) => !["stored", "failed", "nsfw", "canceled", "timed_out"].includes(j.status))).toBe(true)
  })
})
