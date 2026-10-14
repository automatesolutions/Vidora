// Credit pricing (docs/PLAN.md §Pricing). 1 credit = $0.25 to the customer, about $0.08 provider cost.

export const VIDEO_TIERS = ["short_standard", "short_premium", "long_standard"] as const
export type VideoTier = (typeof VIDEO_TIERS)[number]

export const CREDIT_COST: Record<VideoTier, number> = {
  short_standard: 20,
  short_premium: 60,
  long_standard: 150,
}

// Short lengths the create-video wizard offers. Priced below the 45 s Standard short (20 credits),
// at about $0.08 provider cost per credit: 8 s ≈ $0.48 budget, 15 s ≈ $0.80 budget.
export const SHORT_LENGTHS = [8, 15] as const
export type ShortLength = (typeof SHORT_LENGTHS)[number]

export const SHORT_CREDIT_COST: Record<ShortLength, number> = { 8: 6, 15: 10 }

// The pipeline stops before it spends more than this (limits.max_cost_usd). Leaves room under the budget.
const SHORT_MAX_COST_USD: Record<ShortLength, number> = { 8: 0.45, 15: 0.75 }

export function isShortLength(sec: number): sec is ShortLength {
  return (SHORT_LENGTHS as readonly number[]).includes(sec)
}

export function shortCreditCost(lengthSec: number): number {
  if (!isShortLength(lengthSec)) throw new Error(`Shorts are ${SHORT_LENGTHS.join(" or ")} seconds, not ${lengthSec}`)
  return SHORT_CREDIT_COST[lengthSec]
}

export function shortMaxCostUsd(lengthSec: number): number {
  if (!isShortLength(lengthSec)) throw new Error(`Shorts are ${SHORT_LENGTHS.join(" or ")} seconds, not ${lengthSec}`)
  return SHORT_MAX_COST_USD[lengthSec]
}

/**
 * What a new short costs. Each workspace's first video is free (on top of the trial credits).
 * `creditsBase` is the list price, kept on the job so change requests are priced from it.
 */
export function creditsForNewVideo(input: { lengthSec: number; freeVideoAvailable: boolean }) {
  const creditsBase = shortCreditCost(input.lengthSec)
  return input.freeVideoAvailable
    ? { creditsBase, credits: 0, isFree: true as const }
    : { creditsBase, credits: creditsBase, isFree: false as const }
}

export const FREE_CHANGE_REQUESTS = 2

export const PLANS = {
  trial: { name: "Trial", monthlyUsd: 0, credits: 40, concurrentJobs: 1, accounts: 2 },
  creator: { name: "Creator", monthlyUsd: 39, credits: 160, concurrentJobs: 1, accounts: 2 },
  pro: { name: "Pro", monthlyUsd: 99, credits: 450, concurrentJobs: 3, accounts: 6 },
  studio: { name: "Studio", monthlyUsd: 249, credits: 1200, concurrentJobs: 6, accounts: 20 },
} as const
export type PlanId = keyof typeof PLANS

export const TOPUP = { credits: 100, usd: 29 } as const

// Share of a video's cost spent in each stage (visual generation dominates).
export const STAGES = ["ideation", "script", "voiceover", "visuals", "captions", "thumbnail", "render"] as const
export type Stage = (typeof STAGES)[number]

const STAGE_COST_SHARE: Record<Stage, number> = {
  ideation: 0.02,
  script: 0.03,
  voiceover: 0.1,
  visuals: 0.7,
  captions: 0.03,
  thumbnail: 0.05,
  render: 0.07,
}

/** What a reviewer can ask to redo, mapped to the stage the rerun starts from. */
export const CHANGE_TARGETS = { script: "script", voice: "voiceover", visuals: "visuals", captions: "captions", thumbnail: "thumbnail" } as const
export type ChangeTarget = keyof typeof CHANGE_TARGETS

/** The pipeline is linear: a rerun starts at the earliest picked part and redoes everything after it. */
export function rerunFromStage(targets: readonly ChangeTarget[]): Stage {
  if (targets.length === 0) throw new Error("Pick at least one part to change")
  const idx = Math.min(...targets.map((t) => STAGES.indexOf(CHANGE_TARGETS[t])))
  return STAGES[idx]!
}

/**
 * Credits for a change request. The first FREE_CHANGE_REQUESTS per video are free.
 * `baseCredits` is the video's own list price (a 15 s short is 10, not the tier's 20).
 */
export function changeRequestCost(baseCredits: number, fromStage: Stage, changeRequestsSoFar: number): number {
  if (changeRequestsSoFar < FREE_CHANGE_REQUESTS) return 0
  const share = STAGES.slice(STAGES.indexOf(fromStage)).reduce((sum, s) => sum + STAGE_COST_SHARE[s], 0)
  return Math.max(1, Math.ceil(baseCredits * share))
}

/**
 * Balance after a ledger entry. Reservations hold credits; a charge converts a reservation;
 * a release gives it back. `available` is what the creator can still spend.
 */
export type LedgerReason = "grant" | "topup" | "reserve" | "release" | "charge" | "refund" | "expire"

export function applyLedger(
  balance: { available: number; reserved: number },
  reason: LedgerReason,
  credits: number
): { available: number; reserved: number } {
  if (!Number.isInteger(credits) || credits < 0) throw new Error("Credits must be a non-negative integer")
  const next = { ...balance }
  switch (reason) {
    case "grant":
    case "topup":
    case "refund":
      next.available += credits
      break
    case "reserve":
      if (credits > next.available) throw new InsufficientCreditsError(credits, next.available)
      next.available -= credits
      next.reserved += credits
      break
    case "release":
      next.reserved -= credits
      next.available += credits
      break
    case "charge":
      next.reserved -= credits
      break
    case "expire":
      next.available -= Math.min(credits, next.available)
      break
  }
  if (next.reserved < 0) throw new Error("Reserved credits went below zero")
  return next
}

export class InsufficientCreditsError extends Error {
  constructor(
    readonly needed: number,
    readonly available: number
  ) {
    super(`This needs ${needed} credits and you have ${available}.`)
    this.name = "InsufficientCreditsError"
  }
}
