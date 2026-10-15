import { newId } from "@vidora/core"
import { and, eq, gte, sql } from "drizzle-orm"
import type { DbOrTx } from "./client"
import { spendLedger } from "./schema"

// Spend ledger helpers. Each generation job writes at most one hold, one charge and one release
// (unique index), so replaying a step can never double-count.

type SpendRow = {
  workspaceId: string
  campaignId?: string | null
  runId?: string | null
  generationJobId?: string | null
  kind: "hold" | "release" | "charge"
  usd: number
  credits: number
  note?: string
}

export async function writeSpend(db: DbOrTx, row: SpendRow) {
  await db
    .insert(spendLedger)
    .values({ id: newId("spend"), ...row })
    .onConflictDoNothing({ target: [spendLedger.generationJobId, spendLedger.kind] })
}

export type SpendTotals = { spentUsd: number; heldUsd: number; spentCredits: number; heldCredits: number }

const charged = (col: typeof spendLedger.usd | typeof spendLedger.credits) =>
  sql<string>`coalesce(sum(${col}) filter (where ${spendLedger.kind} = 'charge'), 0)`
// Held = holds not yet released. A stored job writes charge + release, so its hold drops out here.
const held = (col: typeof spendLedger.usd | typeof spendLedger.credits) =>
  sql<string>`coalesce(sum(case ${spendLedger.kind} when 'hold' then ${col} when 'release' then -${col} else 0 end), 0)`

async function sumSpend(db: DbOrTx, where: ReturnType<typeof and>): Promise<SpendTotals> {
  const [r] = await db
    .select({ spentUsd: charged(spendLedger.usd), heldUsd: held(spendLedger.usd), spentCredits: charged(spendLedger.credits), heldCredits: held(spendLedger.credits) })
    .from(spendLedger)
    .where(where)
  return {
    spentUsd: Number(r?.spentUsd ?? 0),
    heldUsd: Number(r?.heldUsd ?? 0),
    spentCredits: Number(r?.spentCredits ?? 0),
    heldCredits: Number(r?.heldCredits ?? 0),
  }
}

/** Charged since `since` plus everything still held, for one campaign (monthly cap check). */
export async function campaignSpend(db: DbOrTx, campaignId: string, since: Date): Promise<SpendTotals> {
  const [month, all] = await Promise.all([
    sumSpend(db, and(eq(spendLedger.campaignId, campaignId), gte(spendLedger.createdAt, since))),
    sumSpend(db, and(eq(spendLedger.campaignId, campaignId))),
  ])
  return { spentUsd: month.spentUsd, spentCredits: month.spentCredits, heldUsd: all.heldUsd, heldCredits: all.heldCredits }
}

export async function workspaceSpend(db: DbOrTx, workspaceId: string, since: Date): Promise<SpendTotals> {
  const [month, all] = await Promise.all([
    sumSpend(db, and(eq(spendLedger.workspaceId, workspaceId), gte(spendLedger.createdAt, since))),
    sumSpend(db, and(eq(spendLedger.workspaceId, workspaceId))),
  ])
  return { spentUsd: month.spentUsd, spentCredits: month.spentCredits, heldUsd: all.heldUsd, heldCredits: all.heldCredits }
}

/** Credits charged since the user last entered their balance: estimated balance = entered − this. */
export async function creditsChargedSince(db: DbOrTx, workspaceId: string, since: Date): Promise<number> {
  return (await sumSpend(db, and(eq(spendLedger.workspaceId, workspaceId), gte(spendLedger.createdAt, since)))).spentCredits
}
