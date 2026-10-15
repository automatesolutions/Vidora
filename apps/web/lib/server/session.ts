import "server-only"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"
import { getDb, getMembership } from "@vidora/db"
import { getAuth } from "@/lib/auth"

// Data access layer for the signed-in user. Pages read it behind <Suspense> (cacheComponents), and every
// server action and route handler calls it again instead of trusting the client.

export type AppSession = {
  userId: string
  name: string
  email: string
  emailVerified: boolean
  workspaceId: string
  role: "owner" | "admin" | "editor" | "viewer"
}

export const getAppSession = cache(async (): Promise<AppSession | null> => {
  // headers() first: during prerendering it stops here, before getAuth() needs DATABASE_URL.
  const h = await headers()
  const s = await getAuth().api.getSession({ headers: h })
  if (!s) return null
  const active = (s.session as { activeOrganizationId?: string | null }).activeOrganizationId
  const m = await getMembership(getDb(), s.user.id, active)
  if (!m) return null
  return { userId: s.user.id, name: s.user.name, email: s.user.email, emailVerified: s.user.emailVerified, workspaceId: m.workspaceId, role: m.role }
})

/** For pages: sends signed-out visitors to sign in, then back here. */
export async function requireSession(returnTo?: string): Promise<AppSession> {
  const s = await getAppSession()
  if (!s) redirect(returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : "/sign-in")
  return s
}

/** Roles that can change campaigns, keys and connections. Viewers can only look. */
export function canEdit(s: AppSession) {
  return s.role !== "viewer"
}

/** Only same-site paths, so `?next=` can't send people to another site. */
export function safeNext(next: string | null | undefined, fallback = "/app") {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback
}
