// End-to-end run pipeline: real Postgres + real FFmpeg, fake Higgsfield / director / YouTube.
//   TEST_DATABASE_URL=postgres://vidora:vidora@localhost:5433/vidora_test pnpm --filter @vidora/worker test
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { newId, tokenKeysFromEnv } from "@vidora/core"
import {
  createCampaign,
  createDb,
  eq,
  generationJobsForRun,
  getRun,
  recordProviderStatus,
  recordStored,
  recordSubmitted,
  runNow,
  saveHiggsfieldConnection,
  saveProviderCredential,
  schema,
  upsertConnectedAccount,
  upsertModels,
  type Db,
} from "@vidora/db"
import type { Director, DirectorResult } from "@vidora/director"
import type { VideoProvider } from "@vidora/providers"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { FFMPEG } from "./assemble"
import { advanceRun, type RunDeps } from "./run-engine"

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const keys = tokenKeysFromEnv("1:" + "e".repeat(64))

const scenePlan = (i: number) => ({
  purpose: (i === 0 ? "hook" : "cta") as "hook" | "cta",
  duration_sec: 3,
  transition_in: (i === 0 ? "none" : "whip_pan") as "none" | "whip_pan",
  voiceover_line: i === 0 ? "Save first, spend second." : "Follow for more.",
  voiceover_performance: "",
  features_anchor: false,
  shot: { shot_type: "", camera_motion: "slow push-in", hero_moment: "" },
  prompt: `Scene ${i} prompt, slow push-in, upright camera, level horizon, vertical 9:16 composition.`,
  negative_prompt: "",
  caption_words: i === 0 ? "Save 20% first" : "Follow",
})
const directorResult: DirectorResult = {
  hook: "Save first, spend second.",
  plan: {
    concept: "Pay yourself first.",
    angle: "quick how-to",
    hook: "Save first, spend second.",
    hook_text: "PAYDAY GONE IN A WEEK?",
    open_loop: { question: "Where does the money go?", planted_in_scene: 0, paid_off_in_scene: 1 },
    loop_ending: "Back to the wallet.",
    subject_anchor: "",
    narrator: { gender: "female", age: "young" },
    continuity: { palette: "", wardrobe_and_props: "", location: "" },
    look: { lighting: "", color_grade: "", style: "", locks: "" },
    scenes: [scenePlan(0), scenePlan(1)],
    voiceover_script: "Save first, spend second. Follow for more.",
    title: "Save first, spend second",
    description: "A tiny habit that fixes payday.",
    hashtags: ["#ipon", "#budget"],
    cta_line: "Follow for more.",
    thumbnail_scene_index: 0,
    self_check: "ok",
  },
  ideation: { hooks: [] },
  warnings: [],
  calls: [],
}

suite("run engine (Postgres + FFmpeg, fake services)", () => {
  let db: Db
  let workspaceId: string
  const store = new Map<string, Uint8Array>()
  const published: { publishAt: Date; title: string }[] = []
  let clip: Uint8Array
  let estimateCredits = 10

  const provider: VideoProvider & { balance(): Promise<{ credits: number }> } = {
    name: "fake",
    listModels: async () => [],
    estimateCost: async () => ({ credits: estimateCredits, usd: 0 }),
    submitGeneration: async () => ({ requestId: crypto.randomUUID(), status: "queued", statusUrl: "", cancelUrl: null, correlationId: null }),
    pollStatus: async (r) => ({ requestId: r.requestId, status: "queued", output: null, error: null, correlationId: null }),
    downloadResult: async () => ({ data: clip, bytes: clip.byteLength, sha256: "x", contentType: "video/mp4" }),
    cancel: async () => false,
    verifyCredentials: async () => ({ ok: true }),
    balance: async () => ({ credits: 900 }),
  }
  const director = { planRun: async () => directorResult, pickHook: () => null, rewriteForModeration: async () => ({ prompt: "", negative_prompt: "", what_changed: "" }) } as unknown as Director
  let now = new Date("2026-10-15T04:00:00Z")
  let deps: RunDeps

  beforeAll(async () => {
    db = createDb(url, { max: 4 })
    workspaceId = newId("workspace")
    await db.insert(schema.workspaces).values({ id: workspaceId, name: "Run test", slug: workspaceId.toLowerCase() })
    // The engine is always the API key (a test value; the fake provider never calls Higgsfield).
    await saveProviderCredential(db, keys, workspaceId, "test-key-id:test-key-secret")
    await upsertConnectedAccount(db, keys, {
      workspaceId,
      platform: "youtube",
      externalId: `UC_fake_${workspaceId}`,
      displayName: "Test channel",
      scopes: [],
      accessToken: "x",
      platformMeta: { fake: true },
    })
    await upsertModels(db, [
      {
        id: "kling-video/v3.0/std/text-to-video",
        provider: "higgsfield",
        family: "kling",
        displayName: "Kling 3.0 Standard",
        workflow: "text-to-video",
        outputKind: "video",
        inputSchema: { properties: { prompt: { type: "string" }, duration: { type: "integer", minimum: 3, maximum: 15 }, aspect_ratio: { enum: ["9:16", "16:9"] }, sound: { enum: ["on", "off"] } } },
        docsUrl: "https://higgsfield.ai",
      },
    ])
    // A real 3-second vertical clip with sound, made by FFmpeg.
    const dir = mkdtempSync(path.join(tmpdir(), "run-test-"))
    execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=24", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "3", "-pix_fmt", "yuv420p", "-shortest", "clip.mp4"], { cwd: dir })
    clip = readFileSync(path.join(dir, "clip.mp4"))
    deps = {
      db,
      storage: { put: async (k, b) => void store.set(k, typeof b === "string" ? new TextEncoder().encode(b) : b), getBytes: async (k) => store.get(k)! },
      tokenKeys: keys,
      providerFor: () => provider,
      director: () => director,
      speak: async () => ({ ok: false, error: "ElevenLabs: payment required" }),
      publish: async (p) => {
        published.push({ publishAt: p.publishAt, title: p.title })
        return { ok: true, externalPostId: "yt_1", externalUrl: "https://youtube.com/shorts/yt_1" }
      },
      workRoot: path.join(dir, "runs"),
      now: () => now,
    }
  }, 60_000)

  const extraWorkspaces: string[] = []
  /** A customer workspace with no video connection of its own. */
  async function customerWorkspace() {
    const id = newId("workspace")
    await db.insert(schema.workspaces).values({ id, name: "Customer", slug: id.toLowerCase() })
    extraWorkspaces.push(id)
    return id
  }

  afterAll(async () => {
    for (const id of extraWorkspaces) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id))
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
    await db.close()
  })

  const campaign = (publishMode: "auto" | "approval", extra: Partial<Parameters<typeof createCampaign>[1]> = {}) =>
    createCampaign(db, {
      workspaceId,
      createdBy: null,
      name: "Budget tips",
      mode: "original",
      brief: { topic: "Budget tips", targetLengthSec: 6 },
      schedule: { frequency: "daily", days: [], times: ["18:00"], timeZone: "Asia/Manila", generateAheadHours: 24 },
      publishMode,
      variationIntensity: "medium",
      activate: true,
      ...extra,
    })

  /** Pretends Higgsfield finished every pending scene of a run. */
  async function finishScenes(runId: string) {
    for (const job of await generationJobsForRun(db, runId)) {
      if (job.status !== "pending") continue
      let j = (await recordSubmitted(db, job, { requestId: crypto.randomUUID(), statusUrl: "", cancelUrl: null, providerStatus: "queued" }))!
      j = (await recordProviderStatus(db, j, { providerStatus: "completed", outputUrl: "https://cdn/x.mp4", outputKind: "video" }))!
      store.set(`k/${j.id}`, clip)
      await recordStored(db, j, { storageKey: `k/${j.id}`, bytes: clip.byteLength, sha256: "x" })
    }
  }

  it("takes a run from planned to published, with a real FFmpeg assembly", async () => {
    const c = await campaign("auto")
    const run = (await runNow(db, workspaceId, c.id, now))!

    let r = await advanceRun(deps, run.id)
    expect(r!.status).toBe("generating")
    expect(r!.plan!.hook).toBe("Save first, spend second.")
    expect(r!.variation).toHaveProperty("visual_style")
    const jobs = await generationJobsForRun(db, run.id)
    expect(jobs).toHaveLength(2)
    expect(jobs[0]!.input).toMatchObject({ aspect_ratio: "9:16", duration: 3, sound: "on" })

    r = await advanceRun(deps, run.id) // scenes still pending
    expect(r!.status).toBe("generating")
    await finishScenes(run.id)
    r = await advanceRun(deps, run.id)
    expect(r!.status).toBe("assembling")

    r = await advanceRun(deps, run.id)
    expect(r!.status).toBe("uploading")
    const [video] = await db.select().from(schema.videos).where(eq(schema.videos.runId, run.id))
    expect(video).toMatchObject({ status: "ready", width: 1080, height: 1920, title: "Save first, spend second" })
    expect(store.get(video!.storageKey!)!.byteLength).toBeGreaterThan(10_000)
    expect(video!.description).toContain("#Shorts")

    r = await advanceRun(deps, run.id)
    expect(r!.status).toBe("scheduled")
    expect(published.at(-1)!.publishAt.getTime()).toBe(run.slotAt.getTime())

    now = new Date(run.slotAt.getTime() + 60_000)
    r = await advanceRun(deps, run.id)
    expect(r!.status).toBe("published")
    const events = await db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, run.id))
    expect(events.map((e) => e.event)).toEqual(["started", "planned", "scenes_ready", "assembled", "uploaded", "published"])
    now = new Date("2026-10-15T04:00:00Z")
  }, 120_000)

  it("waits for a person in approval mode", async () => {
    const c = await campaign("approval")
    const run = (await runNow(db, workspaceId, c.id, now))!
    await advanceRun(deps, run.id)
    await finishScenes(run.id)
    await advanceRun(deps, run.id)
    const r = await advanceRun(deps, run.id)
    expect(r!.status).toBe("awaiting_approval")
    expect(r!.nextCheckAt).toBeNull()
  }, 120_000)

  it("skips the run and pauses the campaign when the monthly credit cap would be passed", async () => {
    const c = await campaign("auto", { monthlyCapCredits: 15 })
    const run = (await runNow(db, workspaceId, c.id, now))!
    const r = await advanceRun(deps, run.id)
    expect(r).toMatchObject({ status: "skipped", errorCode: "monthly_cap" })
    expect(await generationJobsForRun(db, run.id)).toHaveLength(0)
    const [row] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, c.id))
    expect(row!.status).toBe("paused")
  })

  it("retries a failed scene with a new request, then fails the run after two retries", async () => {
    const c = await campaign("auto")
    const run = (await runNow(db, workspaceId, c.id, now))!
    await advanceRun(deps, run.id)
    const failScene0 = async () => {
      const job = (await generationJobsForRun(db, run.id)).filter((j) => j.sceneIndex === 0 && j.status === "pending").at(-1)!
      const s = (await recordSubmitted(db, job, { requestId: crypto.randomUUID(), statusUrl: "", cancelUrl: null, providerStatus: "queued" }))!
      await recordProviderStatus(db, s, { providerStatus: "failed", error: "Generation failed" })
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      await failScene0()
      const r = await advanceRun(deps, run.id)
      if (attempt < 3) expect(r!.status).toBe("generating")
      else expect(r).toMatchObject({ status: "failed", errorCode: "scene_failed" })
    }
    const attempts = (await generationJobsForRun(db, run.id)).filter((j) => j.sceneIndex === 0).map((j) => j.attempt)
    expect(attempts).toEqual([1, 2, 3])
    expect((await getRun(db, run.id))!.errorMessage).toMatch(/Scene 1 couldn't be generated/)
  }, 60_000)

  it("makes a customer's video with the platform's connection when PLATFORM_WORKSPACE_ID is set", async () => {
    const customer = await customerWorkspace()
    const c = await campaign("auto", { workspaceId: customer })
    const run = (await runNow(db, customer, c.id, now))!
    const r = await advanceRun({ ...deps, platformWorkspaceId: workspaceId }, run.id)
    expect(r!.status).toBe("generating")
    const [platformCredential] = await db.select().from(schema.providerCredentials).where(eq(schema.providerCredentials.workspaceId, workspaceId))
    const jobs = await generationJobsForRun(db, run.id)
    expect(jobs.length).toBeGreaterThan(0)
    expect(jobs.every((j) => j.credentialId === platformCredential!.id && j.workspaceId === customer)).toBe(true)
  })

  it("keeps engine trouble away from customers: neutral message, campaign keeps running, operator notified", async () => {
    const customer = await customerWorkspace()
    const operator = await customerWorkspace() // a platform workspace that isn't connected
    const c = await campaign("auto", { workspaceId: customer })
    const run = (await runNow(db, customer, c.id, now))!
    const r = await advanceRun({ ...deps, platformWorkspaceId: operator }, run.id)
    expect(r).toMatchObject({ status: "failed", errorCode: "no_provider" })
    expect(r!.errorMessage).not.toMatch(/higgsfield/i)
    const [row] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, c.id))
    expect(row!.status).toBe("active")
    const alerts = await db.select().from(schema.notifications).where(eq(schema.notifications.workspaceId, operator))
    expect(alerts.map((a) => a.type)).toEqual(["engine_attention"])
  })

  it("never makes videos with a Higgsfield plan connection, only the API key", async () => {
    const planOnly = await customerWorkspace()
    await saveHiggsfieldConnection(db, keys, planOnly, { clientId: "c", accessToken: "a", refreshToken: null, expiresAt: null }, { plan: "plus", credits: 900 })
    const c = await campaign("auto", { workspaceId: planOnly })
    const run = (await runNow(db, planOnly, c.id, now))!
    const r = await advanceRun(deps, run.id)
    expect(r).toMatchObject({ status: "failed", errorCode: "no_provider" })
    expect(await generationJobsForRun(db, run.id)).toEqual([])
  })

  it("fails clearly without the director key", async () => {
    const c = await campaign("auto")
    const run = (await runNow(db, workspaceId, c.id, now))!
    const r = await advanceRun({ ...deps, director: () => null }, run.id)
    expect(r).toMatchObject({ status: "failed", errorCode: "no_director" })
  })
})
