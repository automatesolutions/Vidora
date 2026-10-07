import { and, eq, type SQL } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"

// Tenant isolation: every app query on a tenant table goes through `inWorkspace`, so the
// workspace filter can't be forgotten. Row-level security follows in Phase 3.
export function inWorkspace(table: { workspaceId: PgColumn }, workspaceId: string, ...more: (SQL | undefined)[]) {
  if (!workspaceId) throw new Error("workspaceId is required")
  return and(eq(table.workspaceId, workspaceId), ...more)
}
