// YouTube publishing with Google mocked. The Postgres part runs when TEST_DATABASE_URL is set.
import { newId, tokenKeysFromEnv, type VideoBrief } from "@vidora/core"
import {
  applyCallback,
  approveJob,
  claimJob,
  createDb,
  createJob,
  eq,
  provisionWorkspaceForUser,
  retryPostsAfterReconnect,
  schema,
  upsertConnectedAccount,
  type Db,
} from "@vidora/db"
import type { Storage } from "@vidora/storage"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { publishDuePosts } from "./publish"
import { AuthError, refreshAccessToken, uploadShort } from "./youtube"

type Call = { url: string; init: RequestInit }

/** A fetch stand-in that answers like Google and records every request. */
function fakeGoogle(overrides: Partial<Record<"token" | "start" | "put" | "thumb", () => Response>> = {}) {
  const calls: Call[] = []
  const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return overrides.token?.() ?? Response.json({ access_token: "ya29.fresh", expires_in: 3600 })
    }
    if (url.includes("/upload/youtube/v3/videos")) {
      return overrides.start?.() ?? new Response(null, { status: 200, headers: { location: "https://upload.example/session-1" } })
    }
    if (url === "https://upload.example/session-1") return overrides.put?.() ?? Response.json({ id: "dQw4w9WgXcQ" })
    if (url.includes("/thumbnails/set")) return overrides.thumb?.() ?? Response.json({})
    return new Response("unexpected", { status: 500 })
  }) as unknown as typeof fetch
  return { f, calls }
}

const upload = {
  accessToken: "ya29.access",
  title: "Octopuses have three hearts",
  description: "Two pump blood to the gills.\n\n#Shorts #octopus",
  visibility: "public" as const,
  madeForKids: false,
  audited: false,
  video: new Uint8Array([1, 2, 3]),
  cover: new Uint8Array([0xff, 0xd8, 0xff]),
}

describe("youtube upload", () => {
  it("uploads private with the AI label until the audit passes, then sets the cover", async () => {
    const { f, calls } = fakeGoogle()
    const r = await uploadShort(f, upload)
    expect(r).toEqual({ ok: true, externalPostId: "dQw4w9WgXcQ", externalUrl: "https://youtube.com/shorts/dQw4w9WgXcQ" })
    const meta = JSON.parse(String(calls[0]!.init.body))
    expect(meta.status).toEqual({ privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: true })
    expect(meta.snippet.title).toBe("Octopuses have three hearts")
    expect((calls[0]!.init.headers as Record<string, string>)["x-upload-content-length"]).toBe("3")
    expect(calls[1]!.init.method).toBe("PUT")
    expect(calls[2]!.url).toContain("thumbnails/set?videoId=dQw4w9WgXcQ")
  })

  it("keeps the creator's visibility once audited", async () => {
    const { f, calls } = fakeGoogle()
    await uploadShort(f, { ...upload, audited: true, visibility: "unlisted", madeForKids: true })
    expect(JSON.parse(String(calls[0]!.init.body)).status).toMatchObject({ privacyStatus: "unlisted", selfDeclaredMadeForKids: true })
  })

  it("still counts the post when the cover can't be set (unverified channel)", async () => {
    const { f } = fakeGoogle({ thumb: () => new Response("forbidden", { status: 403 }) })
    expect((await uploadShort(f, upload)).ok).toBe(true)
  })

  it("sorts failures into auth, retryable, and permanent", async () => {
    const err = (status: number, reason: string) => () => new Response(JSON.stringify({ error: { errors: [{ reason }] } }), { status })
    expect(await uploadShort(fakeGoogle({ start: err(401, "authError") }).f, upload)).toMatchObject({ ok: false, kind: "auth" })
    expect(await uploadShort(fakeGoogle({ start: err(403, "quotaExceeded") }).f, upload)).toMatchObject({ ok: false, kind: "retryable" })
    expect(await uploadShort(fakeGoogle({ put: err(503, "backendError") }).f, upload)).toMatchObject({ ok: false, kind: "retryable" })
    expect(await uploadShort(fakeGoogle({ start: err(400, "invalidTitle") }).f, upload)).toMatchObject({ ok: false, kind: "permanent" })
  })

  it("treats a revoked refresh token as a login problem", async () => {
    const { f } = fakeGoogle({ token: () => Response.json({ error: "invalid_grant" }, { status: 400 }) })
    await expect(refreshAccessToken(f, { clientId: "c", clientSecret: "s" }, "1//old")).rejects.toBeInstanceOf(AuthError)
  })
})

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

suite("publishing (Postgres)", () => {
  let db: Db
  const userId = newId("user")
  let ws: string
  const keys = tokenKeysFromEnv("1:" + "d".repeat(64))
  const env = { tokenKeys: keys, google: { clientId: "c", clientSecret: "s" }, audited: false }
  const storage = {
    get: async () => ({ Body: { transformToByteArray: async () => new Uint8Array([9, 9, 9]) } }),
  } as unknown as Storage
  const brief: VideoBrief = {
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
  }

  async function approvedJob(accountExpired: boolean) {
    const job = await createJob(db, { workspaceId: ws, brief, actor: { type: "user", id: userId } })
    await claimJob(db, job.id, 1, `exec-${job.id}`)
    await applyCallback(db, {
      event_id: newId("jobEvent"),
      type: "job.completed",
      job_id: job.id,
      revision: 1,
      execution_id: `exec-${job.id}`,
      stage: "render",
      assets: [
        { kind: "final_video", ordinal: 0, storage_key: "samples/short-8s.mp4", mime: "video/mp4" },
        { kind: "thumbnail", ordinal: 0, storage_key: "samples/short-8s-frame-0.jpg", mime: "image/jpeg" },
      ],
      data: { title: "Octopus hearts" },
      cost: [],
      error: null,
    })
    await upsertConnectedAccount(db, keys, {
      workspaceId: ws,
      platform: "youtube",
      externalId: "UC_pub",
      displayName: "Pub channel",
      scopes: [],
      accessToken: "ya29.old",
      refreshToken: "1//refresh",
      accessExpiresAt: accountExpired ? new Date(Date.now() - 1000) : new Date(Date.now() + 3600_000),
    })
    await approveJob(db, { workspaceId: ws, jobId: job.id, actor: { type: "user", id: userId }, postAt: new Date(Date.now() - 1000) })
    return job.id
  }

  const jobStatus = async (id: string) => (await db.select().from(schema.videoJobs).where(eq(schema.videoJobs.id, id)))[0]!.status
  const postOf = async (id: string) => (await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.jobId, id)))[0]!

  beforeAll(async () => {
    db = createDb(url, { max: 4 })
    await db.insert(schema.user).values({ id: userId, name: "Pub Test", email: `${userId}@test.vidora` })
    ws = await provisionWorkspaceForUser(db, { id: userId, name: "Pub Test", email: `${userId}@test.vidora` })
  })

  afterAll(async () => {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws))
    await db.delete(schema.user).where(eq(schema.user.id, userId))
    await db.close()
  })

  it("refreshes an expired token, uploads, and marks the video posted", async () => {
    const id = await approvedJob(true)
    const { f, calls } = fakeGoogle()
    expect(await publishDuePosts(db, storage, env, f)).toBeGreaterThanOrEqual(1)
    expect(calls[0]!.url).toContain("oauth2.googleapis.com/token")
    expect(await jobStatus(id)).toBe("published")
    expect(await postOf(id)).toMatchObject({ status: "published", externalPostId: "dQw4w9WgXcQ", externalUrl: "https://youtube.com/shorts/dQw4w9WgXcQ" })
  })

  it("stops on an expired login, asks to reconnect, and retries after reconnecting", async () => {
    const id = await approvedJob(true)
    await publishDuePosts(db, storage, env, fakeGoogle({ token: () => Response.json({ error: "invalid_grant" }, { status: 400 }) }).f)
    expect(await jobStatus(id)).toBe("publish_failed")
    const post = await postOf(id)
    expect(post.status).toBe("needs_reauth")
    const [acct] = await db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, post.connectedAccountId))
    expect(acct!.status).toBe("needs_reauth")

    // Reconnecting saves fresh tokens and puts the post back in line.
    await upsertConnectedAccount(db, keys, {
      workspaceId: ws,
      platform: "youtube",
      externalId: "UC_pub",
      displayName: "Pub channel",
      scopes: [],
      accessToken: "ya29.new",
      refreshToken: "1//new",
      accessExpiresAt: new Date(Date.now() + 3600_000),
    })
    expect(await retryPostsAfterReconnect(db, ws, post.connectedAccountId)).toBe(1)
    expect(await jobStatus(id)).toBe("scheduled")
    await publishDuePosts(db, storage, env, fakeGoogle().f)
    expect(await jobStatus(id)).toBe("published")
  })

  it("retries later when YouTube is busy, without failing the video", async () => {
    const id = await approvedJob(false)
    const busy = () => new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 })
    await publishDuePosts(db, storage, env, fakeGoogle({ start: busy }).f)
    const post = await postOf(id)
    expect(post.status).toBe("scheduled")
    expect(post.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
    expect(post.lastError).toMatch(/quotaExceeded/)
    expect(await jobStatus(id)).toBe("publishing")
  })
})
