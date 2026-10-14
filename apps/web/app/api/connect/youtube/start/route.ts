import { randomBytes } from "node:crypto"
import { seal } from "@vidora/core"
import { getDb, getVideo } from "@vidora/db"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getAppSession } from "@/lib/server/session"
import { appUrl, CONNECT_COOKIE, fakeYouTubeEnabled, googleAuthUrl, oauthStateSecret, pkcePair } from "@/lib/server/youtube"

// Starts "Connect YouTube". The signed state carries the pending approval (video, post time, version),
// so the callback can finish it. The PKCE verifier and a nonce stay in an httpOnly cookie.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const s = await getAppSession()
  if (!s) return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`, appUrl()))

  const jobId = url.searchParams.get("job")
  const postAt = url.searchParams.get("postAt")
  const reconnect = url.searchParams.get("reconnect") === "1"
  const job = jobId ? await getVideo(getDb(), s.workspaceId, jobId) : null
  if (jobId && !job) return NextResponse.redirect(new URL("/app/videos", appUrl()))

  const secret = oauthStateSecret()
  const nonce = randomBytes(16).toString("base64url")
  const { verifier, challenge } = pkcePair()
  const state = seal(
    {
      w: s.workspaceId,
      u: s.userId,
      job: job?.id ?? null,
      postAt: !reconnect && postAt && !Number.isNaN(Date.parse(postAt)) ? postAt : null,
      v: job?.version ?? null,
      r: reconnect,
      n: nonce,
    },
    secret,
    600
  )
  ;(await cookies()).set(CONNECT_COOKIE, seal({ n: nonce, pv: verifier }, secret, 600), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/connect/youtube",
    maxAge: 600,
  })

  if (fakeYouTubeEnabled()) {
    return NextResponse.redirect(new URL(`/api/connect/youtube/dev-consent?state=${encodeURIComponent(state)}`, appUrl()))
  }
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID) {
    return NextResponse.redirect(new URL(job ? `/app/videos/${job.id}/review?connect=failed` : "/app/videos", appUrl()))
  }
  return NextResponse.redirect(googleAuthUrl(state, challenge))
}
