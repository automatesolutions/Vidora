import { randomBytes } from "node:crypto"
import { seal } from "@vidora/core"
import { getDb } from "@vidora/db"
import { authorizationUrl } from "@vidora/providers"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { HF_CONNECT_COOKIE, higgsfieldClientId, higgsfieldRedirectUri } from "@/lib/server/higgsfield"
import { isOperator } from "@/lib/server/platform"
import { canEdit, getAppSession } from "@/lib/server/session"
import { appUrl, oauthStateSecret } from "@/lib/server/youtube"

// Starts "Connect Higgsfield": sends the user to Higgsfield's own sign-in page. The signed state names
// the workspace and user; the PKCE verifier stays in an httpOnly cookie.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const s = await getAppSession()
  if (!s) return NextResponse.redirect(new URL(`/sign-in?next=${encodeURIComponent(url.pathname)}`, appUrl()))
  // Only the operator connects the video engine; customers never see it.
  if (!isOperator(s.workspaceId)) return NextResponse.redirect(new URL("/app/connections", appUrl()))
  if (!canEdit(s)) return NextResponse.redirect(new URL("/app/connections?higgsfield=forbidden", appUrl()))

  let target: { url: string; codeVerifier: string }
  let clientId: string
  const secret = oauthStateSecret()
  const nonce = randomBytes(16).toString("base64url")
  try {
    clientId = await higgsfieldClientId(getDb())
    target = await authorizationUrl({ clientId, redirectUri: higgsfieldRedirectUri(), state: seal({ w: s.workspaceId, u: s.userId, n: nonce }, secret, 900) })
  } catch (err) {
    console.error("Higgsfield connect start failed", err)
    return NextResponse.redirect(new URL("/app/connections?higgsfield=unavailable", appUrl()))
  }

  ;(await cookies()).set(HF_CONNECT_COOKIE, seal({ n: nonce, pv: target.codeVerifier, c: clientId }, secret, 900), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/connect/higgsfield",
    maxAge: 900,
  })
  return NextResponse.redirect(target.url)
}
