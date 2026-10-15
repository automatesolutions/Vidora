import { isValidTimeZone, newId } from "@vidora/core"
import { and, asc, eq } from "drizzle-orm"
import type { Db } from "./client"
import { workspaceMembers, workspaces } from "./schema"

/**
 * Every new account gets its own workspace and owner membership, in one transaction.
 * Called from Better Auth's `user.create.after` hook. Safe to call twice (returns the existing workspace).
 */
export async function provisionWorkspaceForUser(db: Db, u: { id: string; name: string; email: string }) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, u.id))
      .limit(1)
    if (existing) return existing.workspaceId

    const id = newId("workspace")
    const first = (u.name || u.email.split("@")[0] || "My").trim().split(/\s+/)[0]!
    await tx.insert(workspaces).values({
      id,
      name: `${first}'s workspace`.slice(0, 80),
      slug: id.toLowerCase().replace("_", "-"),
      createdBy: u.id,
    })
    await tx.insert(workspaceMembers).values({ id: newId("member"), workspaceId: id, userId: u.id, role: "owner" })
    return id
  })
}

export type Membership = { workspaceId: string; role: "owner" | "admin" | "editor" | "viewer" }

/** The user's role in `workspaceId`, or their first workspace when none is given. Null when not a member. */
export async function getMembership(db: Db, userId: string, workspaceId?: string | null): Promise<Membership | null> {
  const [m] = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(workspaceId ? and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)) : eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1)
  return m ?? null
}

export async function getWorkspace(db: Db, workspaceId: string) {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return w ?? null
}

export async function setWorkspaceTimeZone(db: Db, workspaceId: string, timeZone: string) {
  if (!isValidTimeZone(timeZone)) throw new Error("Unknown time zone")
  await db.update(workspaces).set({ timezone: timeZone }).where(eq(workspaces.id, workspaceId))
}
