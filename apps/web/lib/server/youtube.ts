import "server-only"
import { createHash, randomBytes } from "node:crypto"

// Google OAuth for connecting a YouTube channel (not for signing in). Tokens never reach the browser.

export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]
export const REDIRECT_PATH = "/api/connect/youtube/callback"
export const CONNECT_COOKIE = "vidora_yt_connect"

/** Local testing without Google: a fake channel, and the worker simulates the upload. Never in production. */
export function fakeYouTubeEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_FAKE_YOUTUBE === "true" && !process.env.GOOGLE_OAUTH_CLIENT_ID
}

export function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3010").replace(/\/$/, "")
}

export function oauthStateSecret() {
  const s = process.env.OAUTH_STATE_SECRET
  if (!s) throw new Error("OAUTH_STATE_SECRET is not set (see .env.example)")
  return s
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url")
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") }
}

export function googleAuthUrl(state: string, challenge: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: appUrl() + REDIRECT_PATH,
    response_type: "code",
    scope: YT_SCOPES.join(" "),
    access_type: "offline", // refresh token, so we can post at the approved time
    prompt: "consent", // Google only returns a refresh token on consent
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString()
  return u.toString()
}

export async function exchangeCode(code: string, verifier: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: appUrl() + REDIRECT_PATH,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`)
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
    scopes: t.scope.split(" "),
  }
}

export async function fetchMyChannel(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`YouTube channels.list failed (${res.status})`)
  const body = (await res.json()) as {
    items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[]
  }
  const c = body.items?.[0]
  return c ? { id: c.id, title: c.snippet.title, handle: c.snippet.customUrl ?? null, avatarUrl: c.snippet.thumbnails?.default?.url ?? null } : null
}
