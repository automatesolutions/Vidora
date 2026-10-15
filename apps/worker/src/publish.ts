import type { TokenKey } from "@vidora/core"
import { logUpload, markAccountNeedsReauth, readTokens, saveRefreshedAccessToken, type ConnectedAccount, type Db } from "@vidora/db"
import { log } from "./log"
import { AuthError, refreshAccessToken, uploadShort, type PublishOutcome } from "./youtube"

// Uploads one finished Short to a connected YouTube channel as private with a publish time.
// A test channel (Connections without Google credentials, ALLOW_FAKE_YOUTUBE) simulates the upload.

export type PublishInput = {
  workspaceId: string
  videoId: string
  account: ConnectedAccount
  video: Uint8Array
  cover: Uint8Array | null
  title: string
  description: string
  tags: string[]
  madeForKids: boolean
  publishAt: Date
}

export type PublishDeps = {
  db: Db
  tokenKeys: readonly TokenKey[]
  google: { clientId: string; clientSecret: string } | null
  audited: boolean
  fetch?: typeof fetch
}

// videos.insert costs about 1,600 quota units; thumbnails.set about 50 (YouTube Data API v3).
const INSERT_UNITS = 1600

export async function publishToYouTube(deps: PublishDeps, p: PublishInput): Promise<PublishOutcome> {
  const f = deps.fetch ?? fetch
  if ((p.account.platformMeta as { fake?: boolean }).fake) {
    const id = `fake_${p.videoId.slice(-10)}`
    await logUpload(deps.db, { workspaceId: p.workspaceId, videoId: p.videoId, accountId: p.account.id, step: "insert", ok: true, quotaUnits: 0, youtubeVideoId: id, error: "simulated (test channel)" })
    log.info("youtube upload simulated", { videoId: p.videoId, publishAt: p.publishAt.toISOString() })
    return { ok: true, externalPostId: id, externalUrl: `https://youtube.com/shorts/${id}` }
  }

  let { accessToken } = readTokens(p.account, deps.tokenKeys)
  const { refreshToken } = readTokens(p.account, deps.tokenKeys)
  try {
    if (!p.account.accessExpiresAt || p.account.accessExpiresAt.getTime() - Date.now() < 5 * 60_000) {
      if (!deps.google || !refreshToken) throw new AuthError("Your YouTube login expired.")
      const r = await refreshAccessToken(f, deps.google, refreshToken)
      accessToken = r.accessToken
      await saveRefreshedAccessToken(deps.db, deps.tokenKeys, p.account.id, r.accessToken, r.expiresAt)
    }
  } catch (err) {
    if (err instanceof AuthError) {
      await markAccountNeedsReauth(deps.db, p.account.id)
      await logUpload(deps.db, { workspaceId: p.workspaceId, videoId: p.videoId, accountId: p.account.id, step: "refresh_token", ok: false, error: err.message })
      return { ok: false, kind: "auth", error: err.message }
    }
    return { ok: false, kind: "retryable", error: (err as Error).message }
  }

  const outcome = await uploadShort(f, {
    accessToken,
    title: p.title,
    description: p.description,
    tags: p.tags,
    visibility: "private",
    madeForKids: p.madeForKids,
    audited: deps.audited,
    video: p.video,
    cover: p.cover,
    publishAt: p.publishAt,
  })
  await logUpload(deps.db, {
    workspaceId: p.workspaceId,
    videoId: p.videoId,
    accountId: p.account.id,
    step: "insert",
    ok: outcome.ok,
    quotaUnits: INSERT_UNITS,
    youtubeVideoId: outcome.ok ? outcome.externalPostId : null,
    error: outcome.ok ? null : outcome.error,
  })
  if (!outcome.ok && outcome.kind === "auth") await markAccountNeedsReauth(deps.db, p.account.id)
  return outcome
}
