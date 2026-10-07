import { applyLedger, newId, type LedgerReason } from "@vidora/core"
import { desc, eq, sql } from "drizzle-orm"
import type { Tx } from "./client"
import { creditLedger, workspaces } from "./schema"

/** Current balance from the newest ledger row. Call inside a transaction that holds the workspace lock. */
export async function getBalance(tx: Tx, workspaceId: string) {
  const [last] = await tx
    .select({ available: creditLedger.availableAfter, reserved: creditLedger.reservedAfter })
    .from(creditLedger)
    .where(eq(creditLedger.workspaceId, workspaceId))
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(1)
  return last ?? { available: 0, reserved: 0 }
}

/** Serializes ledger writes for one workspace (row lock on the workspace). */
export async function lockWorkspace(tx: Tx, workspaceId: string) {
  const rows = await tx.execute(sql`select id from ${workspaces} where ${workspaces.id} = ${workspaceId} for update`)
  if (rows.length === 0) throw new Error(`Workspace ${workspaceId} not found`)
}

export async function writeLedger(
  tx: Tx,
  entry: { workspaceId: string; reason: LedgerReason; credits: number; jobId?: string; stripeRef?: string; note?: string }
) {
  await lockWorkspace(tx, entry.workspaceId)
  const next = applyLedger(await getBalance(tx, entry.workspaceId), entry.reason, entry.credits)
  await tx.insert(creditLedger).values({
    id: newId("ledger"),
    workspaceId: entry.workspaceId,
    reason: entry.reason,
    credits: entry.credits,
    availableAfter: next.available,
    reservedAfter: next.reserved,
    jobId: entry.jobId,
    stripeRef: entry.stripeRef,
    note: entry.note,
  })
  return next
}
