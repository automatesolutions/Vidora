import { getSessionCookie } from "better-auth/cookies"
import { NextResponse, type NextRequest } from "next/server"

// Optimistic check only: no session cookie → sign in. Pages and actions still verify the session
// (lib/server/session.ts), because a cookie can exist and still be invalid.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next()
  const url = new URL("/sign-in", request.url)
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(url)
}

export const config = { matcher: ["/app/:path*"] }
