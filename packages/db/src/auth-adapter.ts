import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { newId, type IdKind } from "@vidora/core"
import type { Db } from "./client"
import { account, invitation, session, user, verification, workspaceMembers, workspaces } from "./schema"

// Better Auth reads and writes our tables through Drizzle. The organization plugin's models map onto
// workspaces / workspace_members, so a Better Auth "organization" is a Vidora workspace (ws_ IDs).
// Checked against `npx @better-auth/cli generate` for better-auth 1.7.7 (see docs/PLAN.md Phase 1 notes).

export function authDatabase(db: Db) {
  return drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification, workspaces, workspaceMembers, invitation },
  })
}

/** Pass to `organization({ schema })` so the plugin uses our table and column names. */
export const ORGANIZATION_SCHEMA = {
  organization: { modelName: "workspaces" },
  member: { modelName: "workspaceMembers", fields: { organizationId: "workspaceId" } },
  invitation: { modelName: "invitation", fields: { organizationId: "workspaceId" } },
  session: { fields: { activeOrganizationId: "activeWorkspaceId" } },
} as const

const MODEL_ID_KIND: Record<string, IdKind> = {
  user: "user",
  session: "session",
  account: "authAccount",
  verification: "verification",
  organization: "workspace",
  workspaces: "workspace",
  member: "member",
  workspaceMembers: "member",
  invitation: "invitation",
}

/** Prefixed, time-sortable IDs for Better Auth rows, like every other Vidora table. */
export function generateAuthId({ model }: { model: string }): string {
  return newId(MODEL_ID_KIND[model] ?? "authOther")
}
