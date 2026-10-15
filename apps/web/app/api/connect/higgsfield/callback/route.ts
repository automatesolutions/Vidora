import { tokenKeysFromEnv, unseal } from "@vidora/core"
import { getDb, saveHiggsfieldConnection } from "@vidora/db"
import { exchangeCode, HiggsfieldMcpProvider } from "@vidora/providers"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { HF_CONNECT_COOKIE, higgsfieldRedirectUri } from "@/lib/server/higgsfield"
import { getAppSession } from "@/lib/server/session"
import { appUrl, oauthStateSecret } from "@/lib/server/youtube"

type State = { w: string; u: string; n: string }

// Higgsfield sends the user back here after sign-in. We trade the code for tokens, check them by
// reading the plan balance, and save the connection encrypted.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const jar = await cookies()
  const secret = oauthStateSecret()
  const st = unseal<State>(url.searchParams.get("state") ?? "", secret)
  const ck = unseal<{ n: string; pv: string; c: string }>(jar.get(HF_CONNECT_COOKIE)?.value ?? "", secret)
  jar.delete({ name: HF_CONNECT_COOKIE, path: "/api/connect/higgsfield" })
  const back = (query: string) => NextResponse.redirect(new URL(`/app/connections?${query}`, appUrl()))

  if (!st || !ck || ck.n !== st.n) return back("higgsfield=failed")
  const s = await getAppSession()
  if (!s || s.userId !== st.u || s.workspaceId !== st.w) return back("higgsfield=failed")
  if (url.searchParams.get("error")) return back("higgsfield=denied")
  const code = url.searchParams.get("code")
  if (!code) return back("higgsfield=failed")

  try {
    const tokens = await exchangeCode({ clientId: ck.c, code, codeVerifier: ck.pv, redirectUri: higgsfieldRedirectUri() })
    const account = await new HiggsfieldMcpProvider({ accessToken: async () => tokens.accessToken }).balance()
    await saveHiggsfieldConnection(getDb(), tokenKeysFromEnv(process.env.TOKEN_ENCRYPTION_KEYS), s.workspaceId, tokens, account)
  } catch (err) {
    console.error("Higgsfield connect failed", err)
    return back("higgsfield=failed")
  }
  return back("higgsfield=connected")
}
