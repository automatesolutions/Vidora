import { PLANS, isValidTimeZone, newId, type CreatorKind } from "@vidora/core"
import { and, asc, eq } from "drizzle-orm"
import type { Db } from "./client"
import { writeLedger } from "./credits"
import { workspaceMembers, workspaces } from "./schema"

/**
 * Every new account gets its own workspace, owner membership, and the trial credits, in one transaction.
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
    await writeLedger(tx, { workspaceId: id, reason: "grant", credits: PLANS.trial.credits, note: "trial" })
    return id
  })
}

export type Membership = { workspaceId: string; role: "owner" | "admin" | "reviewer" | "viewer" }

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

/** Saves the wizard's "Who are you?" answer and the browser's time zone (only if still the default). */
export async function updateWorkspaceProfile(db: Db, workspaceId: string, input: { kind?: CreatorKind; timeZone?: string }) {
  const w = await getWorkspace(db, workspaceId)
  if (!w) return
  const patch: Partial<typeof workspaces.$inferInsert> = {}
  if (input.kind && input.kind !== w.kind) patch.kind = input.kind
  if (input.timeZone && w.timezone === "UTC" && input.timeZone !== "UTC" && isValidTimeZone(input.timeZone)) patch.timezone = input.timeZone
  if (Object.keys(patch).length) await db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId))
}
