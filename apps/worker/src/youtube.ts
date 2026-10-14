import { youtubeUploadStatus, type Visibility } from "@vidora/core"
import type { PublishOutcome } from "@vidora/db"

// YouTube upload for one approved post: refresh the token if needed, resumable upload, then the cover.
// `fetch` is injectable so tests can stand in for Google.

type Fetch = typeof fetch

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthError"
  }
}

export async function refreshAccessToken(
  f: Fetch,
  creds: { clientId: string; clientSecret: string },
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string }
  // invalid_grant: the creator revoked access or the token expired. Only reconnecting fixes it.
  if (body.error === "invalid_grant" || res.status === 401) throw new AuthError("Your YouTube login expired.")
  if (!res.ok || !body.access_token) throw new Error(`Token refresh failed (${res.status})`)
  return { accessToken: body.access_token, expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000) }
}

export type UploadInput = {
  accessToken: string
  title: string
  description: string
  visibility: Visibility
  madeForKids: boolean
  audited: boolean
  video: Uint8Array
  cover: Uint8Array | null
}

/** Uploads one Short. Returns the outcome the worker records with finishPost. */
export async function uploadShort(f: Fetch, input: UploadInput): Promise<PublishOutcome> {
  const auth = { authorization: `Bearer ${input.accessToken}` }
  const metadata = {
    snippet: { title: input.title.slice(0, 100), description: input.description, categoryId: "22" },
    status: youtubeUploadStatus({ visibility: input.visibility, audited: input.audited, madeForKids: input.madeForKids }),
  }

  const start = await f("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "video/mp4",
      "x-upload-content-length": String(input.video.byteLength),
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(30_000),
  })
  const failure = await classify(start)
  if (failure) return failure
  const location = start.headers.get("location")
  if (!location) return { ok: false, kind: "retryable", error: "YouTube didn't return an upload address." }

  const put = await f(location, {
    method: "PUT",
    headers: { ...auth, "content-type": "video/mp4" },
    body: new Blob([input.video as BlobPart], { type: "video/mp4" }),
    signal: AbortSignal.timeout(10 * 60_000),
  })
  const putFailure = await classify(put)
  if (putFailure) return putFailure
  const video = (await put.json()) as { id: string }

  if (input.cover) {
    // Custom covers need a verified channel; without one this fails, and the post still counts as done.
    const thumb = await f(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(video.id)}`, {
      method: "POST",
      headers: { ...auth, "content-type": "image/jpeg" },
      body: new Blob([input.cover as BlobPart], { type: "image/jpeg" }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null)
    if (thumb && !thumb.ok) console.warn(`thumbnails.set returned ${thumb.status} for ${video.id}`)
  }

  return { ok: true, externalPostId: video.id, externalUrl: `https://youtube.com/shorts/${video.id}` }
}

async function classify(res: Response): Promise<PublishOutcome | null> {
  if (res.ok) return null
  const text = await res.text().catch(() => "")
  const reason = /"reason":\s*"([^"]+)"/.exec(text)?.[1] ?? `HTTP ${res.status}`
  if (res.status === 401) return { ok: false, kind: "auth", error: "Your YouTube login expired." }
  if (reason === "quotaExceeded" || reason === "uploadLimitExceeded" || res.status === 429 || res.status >= 500) {
    return { ok: false, kind: "retryable", error: `YouTube is busy (${reason}). We'll try again.` }
  }
  return { ok: false, kind: "permanent", error: `YouTube refused the upload (${reason}).` }
}
