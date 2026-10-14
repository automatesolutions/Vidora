import { connection } from "next/server"
import { NextResponse } from "next/server"
import { appUrl, fakeYouTubeEnabled } from "@/lib/server/youtube"

// Local development only: stands in for Google's consent screen when no Google OAuth client is set up.
export async function GET(req: Request) {
  await connection() // decided per request, never prerendered
  if (!fakeYouTubeEnabled()) return new Response("Not found", { status: 404 })
  const state = new URL(req.url).searchParams.get("state") ?? ""
  return NextResponse.redirect(new URL(`/api/connect/youtube/callback?code=fake-dev-code&state=${encodeURIComponent(state)}`, appUrl()))
}
