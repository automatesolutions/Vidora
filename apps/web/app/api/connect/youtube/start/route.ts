import { randomBytes } from "node:crypto"
import { seal } from "@vidora/core"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { canEdit, getAppSession } from "@/lib/server/session"
import { appUrl, CONNECT_COOKIE, fakeYouTubeEnabled, googleAuthUrl, oauthStateSecret, pkcePair } from "@/lib/server/youtube"

// Starts "Connect YouTube" (or reconnecting a channel whose login expired). The signed state names the
// workspace and user; the PKCE verifier and a nonce stay in an httpOnly cookie.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const s = await getAppSession()
  if (!s) return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`, appUrl()))
  if (!canEdit(s)) return NextResponse.redirect(new URL("/app/connections?connect=forbidden", appUrl()))

  const secret = oauthStateSecret()
  const nonce = randomBytes(16).toString("base64url")
  const { verifier, challenge } = pkcePair()
  const state = seal({ w: s.workspaceId, u: s.userId, n: nonce }, secret, 600)
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
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID) return NextResponse.redirect(new URL("/app/connections?connect=not_configured", appUrl()))
  return NextResponse.redirect(googleAuthUrl(state, challenge))
}
