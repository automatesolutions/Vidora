import { zonedTimeToUtc } from "./youtube"

// Spend control. Higgsfield is prepaid and bills each successful generation, so every run is checked
// against its campaign's caps before anything is submitted. Amounts are USD (4 decimals) plus the
// provider's own credits, both as returned by Higgsfield's estimate endpoint.

export type BudgetCheckInput = {
  estimateUsd: number // whole run: every scene's generation estimate
  perRunCapUsd: number | null
  monthlyCapUsd: number | null
  spentThisMonthUsd: number // charged this month (settled spend)
  heldUsd: number // reserved by runs still in flight
  /** Last known Higgsfield balance in credits, if the user entered one (the API has no balance endpoint). */
  balanceCredits: number | null
  estimateCredits: number
  lowBalanceCredits: number // stop when the balance would drop below this
  /** Credit caps (plan credits have no dollar price). Optional so dollar-only callers keep working. */
  perRunCapCredits?: number | null
  monthlyCapCredits?: number | null
  spentThisMonthCredits?: number
  heldCredits?: number
}

export type BudgetDecision =
  | { ok: true }
  | { ok: false; reason: "run_cap" | "monthly_cap" | "low_balance"; message: string }

const usd = (n: number) => `$${n.toFixed(2)}`

export function checkBudget(i: BudgetCheckInput): BudgetDecision {
  if (i.perRunCapUsd !== null && i.estimateUsd > i.perRunCapUsd) {
    return { ok: false, reason: "run_cap", message: `This run would cost about ${usd(i.estimateUsd)}, over the ${usd(i.perRunCapUsd)} limit per video.` }
  }
  if (i.monthlyCapUsd !== null && i.spentThisMonthUsd + i.heldUsd + i.estimateUsd > i.monthlyCapUsd) {
    return {
      ok: false,
      reason: "monthly_cap",
      message: `This campaign has used ${usd(i.spentThisMonthUsd + i.heldUsd)} of its ${usd(i.monthlyCapUsd)} monthly budget.`,
    }
  }
  if (i.perRunCapCredits != null && i.estimateCredits > i.perRunCapCredits) {
    return { ok: false, reason: "run_cap", message: `This run would use about ${i.estimateCredits.toFixed(0)} credits, over the ${i.perRunCapCredits} credit limit per video.` }
  }
  const usedCredits = (i.spentThisMonthCredits ?? 0) + (i.heldCredits ?? 0)
  if (i.monthlyCapCredits != null && usedCredits + i.estimateCredits > i.monthlyCapCredits) {
    return { ok: false, reason: "monthly_cap", message: `This campaign has used ${usedCredits.toFixed(0)} of its ${i.monthlyCapCredits} monthly credits.` }
  }
  if (i.balanceCredits !== null && i.balanceCredits - i.estimateCredits < i.lowBalanceCredits) {
    return { ok: false, reason: "low_balance", message: "Your Higgsfield balance is low. Top it up, then resume the campaign." }
  }
  return { ok: true }
}

/** Start of the current calendar month in the workspace's time zone (monthly caps reset then). */
export function monthStart(timeZone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === "year")!.value)
  const month = Number(parts.find((p) => p.type === "month")!.value)
  return zonedTimeToUtc({ year, month, day: 1, hour: 0, minute: 0 }, timeZone)
}

/** Parses Higgsfield's decimal strings ("1.500") safely. */
export function parseDecimal(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""))
  return Number.isFinite(n) ? n : 0
}
