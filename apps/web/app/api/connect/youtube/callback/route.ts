import { TransitionError, tokenKeysFromEnv, unseal } from "@vidora/core"
import { approveJob, getDb, retryPostsAfterReconnect, StaleJobError, upsertConnectedAccount, type ConnectedAccount } from "@vidora/db"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getAppSession } from "@/lib/server/session"
import { appUrl, CONNECT_COOKIE, exchangeCode, fakeYouTubeEnabled, fetchMyChannel, oauthStateSecret, YT_SCOPES } from "@/lib/server/youtube"

type State = { w: string; u: string; job: string | null; postAt: string | null; v: number | null; r: boolean; n: string }

// Google sends the creator back here. We save the channel (tokens encrypted), finish the approval
// they started, and return them to the same review page.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const jar = await cookies()
  const secret = oauthStateSecret()
  const st = unseal<State>(url.searchParams.get("state") ?? "", secret)
  const ck = unseal<{ n: string; pv: string }>(jar.get(CONNECT_COOKIE)?.value ?? "", secret)
  jar.delete({ name: CONNECT_COOKIE, path: "/api/connect/youtube" })

  const back = (query: string) =>
    NextResponse.redirect(new URL(`${st?.job ? `/app/videos/${st.job}/review` : "/app/videos"}?${query}`, appUrl()))

  // The state must be ours, unexpired, from this browser, and for the signed-in workspace.
  if (!st || !ck || ck.n !== st.n) return back("connect=failed")
  const s = await getAppSession()
  if (!s || s.userId !== st.u || s.workspaceId !== st.w) return back("connect=failed")
  if (url.searchParams.get("error")) return back("connect=denied")
  const code = url.searchParams.get("code")
  if (!code) return back("connect=failed")

  const db = getDb()
  const keys = tokenKeysFromEnv(process.env.TOKEN_ENCRYPTION_KEYS)
  let account: ConnectedAccount
  try {
    if (fakeYouTubeEnabled() && code === "fake-dev-code") {
      account = await upsertConnectedAccount(db, keys, {
        workspaceId: s.workspaceId,
        platform: "youtube",
        externalId: `UC_fake_${s.workspaceId.slice(-10)}`,
        displayName: `${s.name.split(" ")[0] || "Test"} (test channel)`,
        handle: "@test-channel",
        scopes: YT_SCOPES,
        accessToken: "fake-access-token",
        refreshToken: "fake-refresh-token",
        accessExpiresAt: new Date(Date.now() + 3600_000),
        platformMeta: { fake: true },
      })
    } else {
      const t = await exchangeCode(code, ck.pv)
      if (!t.scopes.includes(YT_SCOPES[0]!)) return back("connect=missing_scope")
      const channel = await fetchMyChannel(t.accessToken)
      if (!channel) return back("connect=no_channel")
      account = await upsertConnectedAccount(db, keys, {
        workspaceId: s.workspaceId,
        platform: "youtube",
        externalId: channel.id,
        displayName: channel.title,
        handle: channel.handle,
        avatarUrl: channel.avatarUrl,
        scopes: t.scopes,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        accessExpiresAt: t.expiresAt,
      })
    }
  } catch (err) {
    console.error("YouTube connect failed", err)
    return back("connect=failed")
  }

  if (st.r) {
    await retryPostsAfterReconnect(db, s.workspaceId, account.id)
    return back("reconnected=1")
  }
  if (!st.job || !st.postAt) return back("connected=1")
  try {
    await approveJob(db, {
      workspaceId: s.workspaceId,
      jobId: st.job,
      actor: { type: "user", id: s.userId },
      postAt: new Date(st.postAt),
      expectedVersion: st.v ?? undefined,
    })
    return back("approved=1")
  } catch (err) {
    if (err instanceof StaleJobError) return back("connect=stale")
    if (err instanceof TransitionError) return back("connected=1") // already approved in another tab
    throw err
  }
}
