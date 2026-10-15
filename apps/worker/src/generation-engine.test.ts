// End-to-end generation engine against a real Postgres and a fake Higgsfield.
//   TEST_DATABASE_URL=postgres://vidora:vidora@localhost:5433/vidora_test pnpm --filter @vidora/worker test
import { newId, ProviderError, tokenKeysFromEnv, unseal } from "@vidora/core"
import { createDb, createGenerationJob, eq, getGenerationJob, readProviderSecret, saveProviderCredential, schema, type Db } from "@vidora/db"
import type { GenerationResult, Submission, SubmitRequest, VideoProvider } from "@vidora/providers"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { advanceGeneration, type EngineDeps } from "./generation-engine"

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const keys = tokenKeysFromEnv("1:" + "d".repeat(64))

/**
 * Fake Higgsfield with idempotency like the real one: the same key returns the same request, and
 * "billed" counts distinct accepted generations.
 */
class FakeHiggsfield implements VideoProvider {
  readonly name = "fake"
  byKey = new Map<string, Submission>()
  statuses = new Map<string, GenerationResult["status"]>()
  submits: SubmitRequest[] = []
  failNextSubmitAfterAccepting = false
  failSubmitWith: ProviderError | null = null
  credentialsSeen: string[] = []
  get billed() {
    return this.byKey.size
  }
  async listModels() {
    return []
  }
  async estimateCost() {
    return { credits: 10, usd: 0.6 }
  }
  async submitGeneration(req: SubmitRequest): Promise<Submission> {
    this.submits.push(req)
    if (this.failSubmitWith) throw this.failSubmitWith
    let sub = this.byKey.get(req.idempotencyKey)
    if (!sub) {
      const requestId = crypto.randomUUID()
      sub = { requestId, status: "queued", statusUrl: `https://api.higgsfield.ai/requests/${requestId}/status`, cancelUrl: null, correlationId: "c" }
      this.byKey.set(req.idempotencyKey, sub)
      this.statuses.set(requestId, "queued")
    }
    if (this.failNextSubmitAfterAccepting) {
      // Accepted on their side, but the response never reached us.
      this.failNextSubmitAfterAccepting = false
      throw new ProviderError("retry_same", "socket hang up")
    }
    return sub
  }
  async pollStatus(ref: { requestId: string }): Promise<GenerationResult> {
    const status = this.statuses.get(ref.requestId) ?? "queued"
    return {
      requestId: ref.requestId,
      status,
      output: status === "completed" ? { url: `https://cdn.example.com/${ref.requestId}.mp4`, kind: "video", contentType: "video/mp4" } : null,
      error: status === "failed" ? "Generation failed" : null,
      correlationId: null,
    }
  }
  async downloadResult() {
    const data = new Uint8Array([1, 2, 3, 4])
    return { data, bytes: 4, sha256: "ab".repeat(32), contentType: "video/mp4" }
  }
  async cancel() {
    return true
  }
  async verifyCredentials() {
    return { ok: true as const }
  }
}

suite("generation engine (Postgres + fake Higgsfield)", () => {
  let db: Db
  let workspaceId: string
  let credentialId: string
  const puts: string[] = []
  const fake = new FakeHiggsfield()
  let deps: EngineDeps

  beforeAll(async () => {
    db = createDb(url, { max: 4 })
    workspaceId = newId("workspace")
    await db.insert(schema.workspaces).values({ id: workspaceId, name: "Engine test", slug: workspaceId.toLowerCase() })
    credentialId = (await saveProviderCredential(db, keys, workspaceId, "kid_9f2a:secret_long_enough")).id
    deps = {
      db,
      storage: { put: async (key) => void puts.push(key) },
      tokenKeys: keys,
      providerFor: (credential) => {
        fake.credentialsSeen.push(readProviderSecret(credential, keys))
        return fake
      },
      webhook: { baseUrl: "https://app.example.com", secret: "whsec" },
    }
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.close()
  })

  const newJob = () =>
    createGenerationJob(db, {
      workspaceId,
      runId: null,
      campaignId: null,
      credentialId,
      modelId: "kling-video/v3.0/std/text-to-video",
      input: { prompt: "sunrise", aspect_ratio: "9:16" },
      estimate: { credits: 10, usd: 0.6 },
    })

  it("submits, polls and stores, using the decrypted key and a stable signed webhook", async () => {
    const job = await newJob()
    let row = await advanceGeneration(deps, job.id)
    expect(row!.status).toBe("submitted")
    expect(fake.credentialsSeen.at(-1)).toBe("kid_9f2a:secret_long_enough")
    const hook = new URL(fake.submits.at(-1)!.webhookUrl!)
    expect(hook.pathname).toBe(`/api/webhooks/higgsfield/${job.id}`)
    expect(unseal(hook.searchParams.get("t")!, "whsec", job.createdAt.getTime())).toMatchObject({ g: job.id })

    row = await advanceGeneration(deps, job.id)
    expect(row!.status).toBe("submitted") // still queued at the provider
    fake.statuses.set(row!.requestId!, "completed")
    row = await advanceGeneration(deps, job.id)
    expect(row!.status).toBe("completed")
    row = await advanceGeneration(deps, job.id)
    expect(row!.status).toBe("stored")
    expect(row!.storageKey).toBe(`${workspaceId}/generations/${job.id}.mp4`)
    expect(puts).toContain(row!.storageKey)
    // Terminal rows are left alone.
    expect((await advanceGeneration(deps, job.id))!.version).toBe(row!.version)
  })

  it("resumes after a lost submit response without paying twice", async () => {
    const before = fake.billed
    const job = await newJob()
    fake.failNextSubmitAfterAccepting = true
    let row = await advanceGeneration(deps, job.id)
    expect(row!.status).toBe("pending") // we don't know it was accepted
    expect(fake.billed).toBe(before + 1) // ...but Higgsfield did accept (and would bill) it

    // "Restart": a new step reads the row and submits again with the same idempotency key.
    row = await advanceGeneration(deps, job.id)
    expect(row!.status).toBe("submitted")
    expect(fake.billed).toBe(before + 1) // same generation, not a second one
    const keysUsed = fake.submits.slice(-2).map((s) => s.idempotencyKey)
    expect(keysUsed[0]).toBe(keysUsed[1])
    expect(fake.submits.at(-1)!.webhookUrl).toBe(fake.submits.at(-2)!.webhookUrl) // identical replay
  })

  it("fails the job when Higgsfield is out of credits", async () => {
    const job = await newJob()
    fake.failSubmitWith = new ProviderError("no_credits", "Not enough credits", 403)
    const row = await advanceGeneration(deps, job.id)
    fake.failSubmitWith = null
    expect(row).toMatchObject({ status: "failed", errorKind: "no_credits" })
  })

  it("marks the key invalid and stops in-flight work when Higgsfield rejects it", async () => {
    const job = await newJob()
    fake.failSubmitWith = new ProviderError("bad_credentials", "Invalid credentials", 401)
    const row = await advanceGeneration(deps, job.id)
    fake.failSubmitWith = null
    expect(row).toMatchObject({ status: "failed", errorKind: "bad_credentials" })
    const [cred] = await db.select().from(schema.providerCredentials).where(eq(schema.providerCredentials.id, credentialId))
    expect(cred!.status).toBe("invalid")
  })

  it("stops jobs whose key was removed", async () => {
    const job = await newJob()
    await db.update(schema.generationJobs).set({ credentialId: null }).where(eq(schema.generationJobs.id, job.id))
    const row = await advanceGeneration(deps, job.id)
    expect(row).toMatchObject({ status: "failed", errorKind: "bad_credentials" })
    expect((await getGenerationJob(db, job.id))!.nextCheckAt).toBeNull()
  })
})
