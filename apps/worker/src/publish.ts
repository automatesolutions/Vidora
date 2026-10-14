import { tokenKeysFromEnv, type Visibility } from "@vidora/core"
import { claimDuePosts, finishPost, readTokens, saveRefreshedAccessToken, type ClaimedPost, type Db, type PublishOutcome } from "@vidora/db"
import type { Storage } from "@vidora/storage"
import { log } from "./log"
import { AuthError, refreshAccessToken, uploadShort } from "./youtube"

// Posts approved videos when their time comes. Runs in the worker loop (docs/PLAN.md: publishing happens
// in the Vidora worker, never in n8n).

export type PublishEnv = {
  tokenKeys: ReturnType<typeof tokenKeysFromEnv>
  google: { clientId: string; clientSecret: string } | null
  audited: boolean
}

async function bytes(storage: Storage, key: string) {
  const obj = await storage.get(key)
  return obj.Body ? obj.Body.transformToByteArray() : new Uint8Array()
}

export async function publishOne(db: Db, storage: Storage, env: PublishEnv, c: ClaimedPost, f: typeof fetch = fetch): Promise<PublishOutcome> {
  const opts = c.post.platformOptions as { visibility?: Visibility; madeForKids?: boolean }
  if (c.account.status !== "active") return { ok: false, kind: "auth", error: "Your YouTube login expired." }
  if (!c.videoKey) return { ok: false, kind: "permanent", error: "The video file is missing." }

  // Local dev: the fake channel from "Connect YouTube" without Google credentials. Nothing is uploaded.
  if ((c.account.platformMeta as { fake?: boolean }).fake) {
    if (process.env.NODE_ENV === "production") return { ok: false, kind: "permanent", error: "Test channels can't post." }
    log.info("simulated upload to fake channel", { postId: c.post.id })
    return { ok: true, externalPostId: `fake_${c.post.id}`, externalUrl: null }
  }
  if (!env.google) return { ok: false, kind: "retryable", error: "Google OAuth isn't configured on the worker." }

  const tokens = readTokens(c.account, env.tokenKeys)
  let accessToken = tokens.accessToken
  const refreshToken = tokens.refreshToken
  const expiresSoon = !c.account.accessExpiresAt || c.account.accessExpiresAt.getTime() < Date.now() + 120_000
  if (expiresSoon) {
    if (!refreshToken) return { ok: false, kind: "auth", error: "Your YouTube login expired." }
    try {
      const fresh = await refreshAccessToken(f, env.google, refreshToken)
      accessToken = fresh.accessToken
      await saveRefreshedAccessToken(db, env.tokenKeys, c.account.id, fresh.accessToken, fresh.expiresAt)
    } catch (err) {
      if (err instanceof AuthError) return { ok: false, kind: "auth", error: err.message }
      return { ok: false, kind: "retryable", error: String(err) }
    }
  }

  return uploadShort(f, {
    accessToken,
    title: c.post.title || c.job.title || "New Short",
    description: c.post.caption ?? "",
    visibility: opts.visibility ?? "private",
    madeForKids: opts.madeForKids ?? false,
    audited: env.audited,
    video: await bytes(storage, c.videoKey),
    cover: c.coverKey ? await bytes(storage, c.coverKey).catch(() => null) : null,
  })
}

/** One pass: claim due posts, upload each, record the result. Returns how many it handled. */
export async function publishDuePosts(db: Db, storage: Storage, env: PublishEnv, f: typeof fetch = fetch) {
  const claimed = await claimDuePosts(db)
  for (const c of claimed) {
    let outcome: PublishOutcome
    try {
      outcome = await publishOne(db, storage, env, c, f)
    } catch (err) {
      outcome = { ok: false, kind: "retryable", error: String(err).slice(0, 500) }
    }
    const jobStatus = await finishPost(db, c.post.id, outcome)
    log.info("publish attempt", { postId: c.post.id, jobId: c.job.id, ok: outcome.ok, ...(outcome.ok ? {} : { kind: outcome.kind, error: outcome.error }), jobStatus })
  }
  return claimed.length
}
