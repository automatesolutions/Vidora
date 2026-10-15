import { connection, NextResponse } from "next/server"
import { getAuth } from "@/lib/auth"
import { appUrl } from "@/lib/server/youtube"

// Local development only: signs you in as a test account with one click, creating it the first time.
// Returns 404 in production builds. Open http://localhost:3010/api/dev/login
const DEV_EMAIL = "dev@autoshorts.local"
const DEV_PASSWORD = "local-dev-only-password"

export async function GET() {
  await connection() // decided per request, never prerendered
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 })

  const auth = getAuth()
  let res = await auth.api.signInEmail({ body: { email: DEV_EMAIL, password: DEV_PASSWORD }, asResponse: true })
  if (!res.ok) {
    // First visit: create the test account (sign-up signs it in too).
    res = await auth.api.signUpEmail({ body: { email: DEV_EMAIL, password: DEV_PASSWORD, name: "Dev Tester" }, asResponse: true })
  }
  if (!res.ok) return new Response(`Dev sign-in failed (HTTP ${res.status}). Is the database running?`, { status: 500 })

  const redirect = NextResponse.redirect(new URL("/app", appUrl()))
  for (const cookie of res.headers.getSetCookie()) redirect.headers.append("set-cookie", cookie)
  return redirect
}
