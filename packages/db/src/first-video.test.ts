// First-video milestone against a real Postgres. Run with TEST_DATABASE_URL set (compose `dev` profile).
import { newId, tokenKeysFromEnv, type CallbackEvent, type ReviewDetails, type VideoBrief } from "@vidora/core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readTokens, upsertConnectedAccount } from "./accounts"
import { createDb, type Db } from "./client"
import { getBalance } from "./credits"
import { applyCallback, applyJobEvent, buildGenerateRequest, claimJob, createJob } from "./jobs"
import { approveJob, NeedsConnectionError, rejectJob, requestChanges, StaleJobError, undoApprove, updateReviewDetails } from "./review"
import { connectedAccounts, jobEvents, scheduledPosts, user, videoJobs, workspaces } from "./schema"
import { createUpload, saveBrandKit, setUploadStatus, brandKitForPipeline, getUpload } from "./uploads"
import { getProgress, getVideo, listQueue, listVideos } from "./videos"
import { getMembership, provisionWorkspaceForUser } from "./workspaces"

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const keys = tokenKeysFromEnv("1:" + "c".repeat(64))

const brief = (over: Partial<VideoBrief> = {}): VideoBrief => ({
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
  length_sec: 15,
  use_brand_kit: false,
  ...over,
})

const details: ReviewDetails = {
  title: "Octopuses have three hearts",
  description: "Two pump blood to the gills, one to the body.",
  hashtags: ["octopus", "#facts"],
  visibility: "public",
  madeForKids: false,
  coverOrdinal: 2,
}

suite("first video (Postgres)", () => {
  let db: Db
  const userId = newId("user")
  const otherUserId = newId("user")
  let ws: string
  let otherWs: string

  const actor = () => ({ type: "user" as const, id: userId })
  const balance = (w = ws) => getBalance(db, w)
  const ev = (job: { id: string; revision?: number }, type: CallbackEvent["type"], extra: Partial<CallbackEvent> = {}): CallbackEvent => ({
    event_id: newId("jobEvent"),
    type,
    job_id: job.id,
    revision: job.revision ?? 1,
    execution_id: "exec-1",
    stage: null,
    assets: [],
    data: {},
    cost: [],
    error: null,
    ...extra,
  })
  /** Runs a job through claim → stages → completed, like the stub pipeline. */
  async function finish(jobId: string) {
    const [j] = await db.select().from(videoJobs).where(eq(videoJobs.id, jobId))
    const exec = `exec-${j!.revision}-${jobId}`
    await claimJob(db, jobId, j!.revision, exec)
    await applyCallback(db, { ...ev(j!, "job.stage_started", { stage: "script" }), execution_id: exec })
    await applyCallback(db, { ...ev(j!, "job.stage_completed", { stage: "script", progress: 0.3, data: { title: "Octopus hearts" } }), execution_id: exec })
    await applyCallback(db, { ...ev(j!, "job.completed", { stage: "render" }), execution_id: exec })
  }

  beforeAll(async () => {
    db = createDb(url, { max: 6 })
    await db.insert(user).values([
      { id: userId, name: "Mia Santos", email: `${userId}@test.vidora` },
      { id: otherUserId, name: "Other", email: `${otherUserId}@test.vidora` },
    ])
    ws = await provisionWorkspaceForUser(db, { id: userId, name: "Mia Santos", email: `${userId}@test.vidora` })
    otherWs = await provisionWorkspaceForUser(db, { id: otherUserId, name: "Other", email: `${otherUserId}@test.vidora` })
  })

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, ws))
    await db.delete(workspaces).where(eq(workspaces.id, otherWs))
    await db.delete(user).where(eq(user.id, userId))
    await db.delete(user).where(eq(user.id, otherUserId))
    await db.close()
  })

  it("gives a new account a workspace, owner role, and the 40 trial credits", async () => {
    expect(await getMembership(db, userId)).toEqual({ workspaceId: ws, role: "owner" })
    expect(await balance()).toEqual({ available: 40, reserved: 0 })
    expect(await provisionWorkspaceForUser(db, { id: userId, name: "Mia", email: "x" })).toBe(ws) // idempotent
    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, ws))
    expect(w!.name).toBe("Mia's workspace")
  })

  it("makes the first video free, once, even when two are created at the same time", async () => {
    const [a, b] = await Promise.all([
      createJob(db, { workspaceId: ws, brief: brief(), actor: actor() }),
      createJob(db, { workspaceId: ws, brief: brief({ length_sec: 8 }), actor: actor() }),
    ])
    const free = [a, b].filter((j) => j.isFree)
    expect(free).toHaveLength(1)
    const paid = [a, b].find((j) => !j.isFree)!
    expect(paid.creditsReserved).toBe(paid.creditsBase)
    expect(await balance()).toEqual({ available: 40 - paid.creditsBase, reserved: paid.creditsBase })

    // Canceling the undelivered free video gives the free video back; canceling the paid one refunds it.
    for (const j of [a, b]) {
      await db.transaction(async (tx) => {
        const [row] = await tx.select().from(videoJobs).where(eq(videoJobs.id, j.id)).for("update")
        await applyJobEvent(tx, row!, "cancel", actor())
      })
    }
    expect(await balance()).toEqual({ available: 40, reserved: 0 })
    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, ws))
    expect(w!.freeVideoUsedAt).toBeNull()
  })

  it("sends the wizard choices, the photo, and the brand kit to the pipeline", async () => {
    const photo = await createUpload(db, { workspaceId: ws, userId, purpose: "input", mime: "image/jpeg", bytes: 200_000 })
    await setUploadStatus(db, ws, photo.id, "ready")
    const logo = await createUpload(db, { workspaceId: ws, userId, purpose: "logo", mime: "image/png", bytes: 20_000 })
    await setUploadStatus(db, ws, logo.id, "ready")
    await saveBrandKit(db, ws, { logoUploadId: logo.id, colors: ["#ff4f00"], endCardText: "Follow for more" })
    const kit = await brandKitForPipeline(db, ws)
    expect(kit).toEqual({ logo_key: logo.storageKey, colors: ["#FF4F00"], end_card_text: "Follow for more" })

    const job = await createJob(db, {
      workspaceId: ws,
      brief: brief({ video_type: "photo_to_life", topic: null, photo_upload_id: photo.id, no_people_confirmed: true, length_sec: 8, use_brand_kit: true }),
      brandKit: kit,
      actor: actor(),
    })
    expect(job.isFree).toBe(true)
    const req = await buildGenerateRequest(db, job, "http://localhost:3010/api/webhooks/n8n")
    expect(req).toMatchObject({
      video_type: "photo_to_life",
      length_sec: 8,
      strategy: { target_length_sec: 8, language: "en" },
      limits: { max_cost_usd: 0.45, max_clip_seconds: 8 },
      brand_kit: kit,
      input_assets: [{ kind: "photo", storage_key: photo.storageKey, mime: "image/jpeg" }],
    })
    // Another workspace can't read this upload.
    expect(await getUpload(db, otherWs, photo.id)).toBeNull()
  })

  it("logs stage progress in job_events for the progress page", async () => {
    const [job] = await db.select().from(videoJobs).where(eq(videoJobs.workspaceId, ws)).orderBy(videoJobs.createdAt)
    const live = (await listVideos(db, ws, { statuses: ["queued"] })).items[0]!
    await finish(live.id)
    const p = await getProgress(db, ws, live.id)
    expect(p!.job.status).toBe("pending_approval")
    expect(p!.events.map((e) => e.event)).toEqual(["create", "claim", "stage_started", "stage_completed", "complete"])
    const after = await getProgress(db, ws, live.id, p!.events[2]!.id)
    expect(after!.events.map((e) => e.event)).toEqual(["stage_completed", "complete"])
    expect(await getProgress(db, otherWs, live.id)).toBeNull()
    expect(job).toBeDefined()
  })

  it("won't approve until YouTube is connected, then schedules a private, AI-labeled post", async () => {
    const [job] = await listQueue(db, ws)
    expect(job).toBeDefined()
    const postAt = new Date(Date.now() + 3 * 3600_000)
    await expect(approveJob(db, { workspaceId: ws, jobId: job!.id, actor: actor(), postAt, details })).rejects.toBeInstanceOf(NeedsConnectionError)

    // Another workspace can't approve it, even with an account.
    await upsertConnectedAccount(db, keys, {
      workspaceId: otherWs,
      platform: "youtube",
      externalId: "UC_other",
      displayName: "Other channel",
      scopes: [],
      accessToken: "a",
    })
    await expect(approveJob(db, { workspaceId: otherWs, jobId: job!.id, actor: actor(), postAt })).rejects.toThrow(/couldn't find/)

    const acct = await upsertConnectedAccount(db, keys, {
      workspaceId: ws,
      platform: "youtube",
      externalId: "UC_mia",
      displayName: "Mia Makes",
      scopes: ["https://www.googleapis.com/auth/youtube.upload"],
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      accessExpiresAt: new Date(Date.now() + 3600_000),
    })
    const [raw] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, acct.id))
    expect(raw!.accessTokenEnc).not.toContain("ya29")
    expect(readTokens(raw!, keys)).toEqual({ accessToken: "ya29.access", refreshToken: "1//refresh" })

    const before = await getVideo(db, ws, job!.id)
    await expect(approveJob(db, { workspaceId: ws, jobId: job!.id, actor: actor(), postAt, expectedVersion: before!.version - 1 })).rejects.toBeInstanceOf(StaleJobError)

    const r = await approveJob(db, { workspaceId: ws, jobId: job!.id, actor: actor(), postAt, details, expectedVersion: before!.version })
    expect(r.job.status).toBe("scheduled")
    const [post] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.jobId, job!.id))
    expect(post).toMatchObject({
      status: "scheduled",
      platform: "youtube",
      connectedAccountId: acct.id,
      title: "Octopuses have three hearts",
      caption: "Two pump blood to the gills, one to the body.\n\n#Shorts #octopus #facts",
      platformOptions: { visibility: "public", madeForKids: false, containsSyntheticMedia: true, coverOrdinal: 2 },
    })
    expect(post!.scheduledAt.getTime()).toBe(postAt.getTime())

    // Undo puts it back in review and cancels the post; approving again makes a new post.
    expect((await undoApprove(db, { workspaceId: ws, jobId: job!.id, actor: actor() })).status).toBe("pending_approval")
    const [canceled] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, post!.id))
    expect(canceled!.status).toBe("canceled")
    await approveJob(db, { workspaceId: ws, jobId: job!.id, actor: actor(), postAt: new Date(0) })
    const posts = await db.select().from(scheduledPosts).where(eq(scheduledPosts.jobId, job!.id))
    expect(posts).toHaveLength(2)
    // A time in the past posts now, not in the past.
    expect(posts.find((p) => p.status === "scheduled")!.scheduledAt.getTime()).toBeGreaterThan(Date.now() - 60_000)

    const events = await db.select({ e: jobEvents.event }).from(jobEvents).where(eq(jobEvents.jobId, job!.id))
    expect(events.map((x) => x.e)).toEqual(expect.arrayContaining(["approve", "schedule", "undo_approve"]))
  })

  it("edits details only while in review, and logs the change", async () => {
    const job = await createJob(db, { workspaceId: ws, brief: brief({ length_sec: 8 }), actor: actor() })
    await expect(updateReviewDetails(db, { workspaceId: ws, jobId: job.id, actor: actor(), details })).rejects.toBeInstanceOf(StaleJobError)
    await finish(job.id)
    const updated = await updateReviewDetails(db, { workspaceId: ws, jobId: job.id, actor: actor(), details })
    expect(updated).toMatchObject({ title: details.title, hashtags: ["#Shorts", "#octopus", "#facts"], coverOrdinal: 2 })
    const edits = await db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id))
    expect(edits.find((e) => e.event === "details_edited")?.payload).toMatchObject({ fields: expect.arrayContaining(["title"]) })
  })

  it("requests changes: two free, then priced from the video's own cost", async () => {
    const job = await createJob(db, { workspaceId: ws, brief: brief({ length_sec: 15 }), actor: actor() })
    await finish(job.id)
    const start = await balance()

    const first = await requestChanges(db, { workspaceId: ws, jobId: job.id, actor: actor(), targets: ["captions", "voice"], text: "Calmer voice" })
    expect(first).toMatchObject({ credits: 0, fromStage: "voiceover", job: { status: "queued", revision: 2, rerunFromStage: "voiceover" } })
    const req = await buildGenerateRequest(db, first.job, "http://x.test/cb")
    expect(req).toMatchObject({ revision: 2, rerun_from_stage: "voiceover", feedback: { targets: ["captions", "voice"], text: "Calmer voice" } })

    await finish(job.id)
    await requestChanges(db, { workspaceId: ws, jobId: job.id, actor: actor(), targets: ["thumbnail"], text: "" })
    await finish(job.id)
    const third = await requestChanges(db, { workspaceId: ws, jobId: job.id, actor: actor(), targets: ["thumbnail"], text: "Brighter" })
    expect(third.credits).toBe(2) // 12% of 10, rounded up
    expect(await balance()).toEqual({ available: start.available - 2, reserved: start.reserved + 2 })
  })

  it("rejects and keeps the video out of the queue", async () => {
    const job = await createJob(db, { workspaceId: ws, brief: brief({ length_sec: 8 }), actor: actor() })
    await finish(job.id)
    expect((await rejectJob(db, { workspaceId: ws, jobId: job.id, actor: actor() })).status).toBe("rejected")
    expect((await listQueue(db, ws)).some((j) => j.id === job.id)).toBe(false)
  })
})
