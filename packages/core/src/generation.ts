// Generation jobs: one paid request to a video provider (Higgsfield), tracked in `generation_jobs`.
// Pure rules shared by the database layer and the worker. The database row is the source of truth;
// queue messages only say "look at this row again", so a crash or restart never loses a job.
//
//   pending ──submit──▶ submitted ──poll──▶ in_progress ──poll──▶ completed ──download──▶ stored
//      │                    │                    │
//      └────────────────────┴────────────────────┴──▶ failed | nsfw | canceled | timed_out
//
// `pending` rows already carry their idempotency key, so re-submitting after a crash returns the
// original request instead of paying twice.

export const GENERATION_STATUSES = [
  "pending", // row written, idempotency key chosen, not yet accepted by the provider
  "submitted", // provider accepted it (we have its request ID), still queued there
  "in_progress", // provider started generating; can no longer be canceled
  "completed", // provider finished; output URL known, not yet copied to our storage
  "stored", // output copied to our storage: done
  "failed",
  "nsfw", // rejected by the provider's content moderation
  "canceled",
  "timed_out", // took longer than the model's deadline; we stopped waiting
] as const
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]

export const TERMINAL_GENERATION_STATUSES: readonly GenerationStatus[] = ["stored", "failed", "nsfw", "canceled", "timed_out"]
export const isTerminalGeneration = (s: GenerationStatus) => TERMINAL_GENERATION_STATUSES.includes(s)

/** Statuses the provider itself reports (Higgsfield's `status` field). */
export const PROVIDER_STATUSES = ["queued", "in_progress", "completed", "failed", "nsfw", "canceled"] as const
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number]

/** Maps the provider's status onto ours. Unknown values keep the current status (we poll again). */
export function statusFromProvider(current: GenerationStatus, provider: string): GenerationStatus {
  switch (provider) {
    case "queued":
      return current === "pending" ? "submitted" : current
    case "in_progress":
      return "in_progress"
    case "completed":
      return "completed"
    case "failed":
    case "nsfw":
    case "canceled":
      return provider
    default:
      return current
  }
}

// ── Polling ─────────────────────────────────────────────────────────────────
// Higgsfield's guidance: start at 2 s, grow to 10 s, add jitter. Video takes minutes, so we start at
// 5 s and cap at 30 s; webhooks (when the app has a public URL) usually finish the job sooner.

export function nextPollDelayMs(pollCount: number, random = Math.random): number {
  const base = Math.min(5_000 * 1.5 ** pollCount, 30_000)
  return Math.round(base + random() * 1_000)
}

/** How long we wait for one generation before giving up (model-specific, default 30 minutes). */
export function generationDeadline(submittedAt: Date, timeoutSec = 30 * 60): Date {
  return new Date(submittedAt.getTime() + timeoutSec * 1000)
}

// ── Errors and retries ──────────────────────────────────────────────────────

/**
 * How a provider error should be handled.
 * - retry_same: ambiguous (network, timeout, 5xx). Repeat with the SAME idempotency key.
 * - wait: the provider is busy (concurrency limit, model temporarily blocked). Try later, same key.
 * - no_credits: the provider balance is empty. Pause the campaign.
 * - bad_credentials: the API key is wrong or revoked. Pause and ask the user to fix it.
 * - invalid: the request itself is wrong. Don't retry unchanged.
 */
export type ProviderErrorKind = "retry_same" | "wait" | "no_credits" | "bad_credentials" | "invalid"

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly httpStatus?: number,
    readonly correlationId?: string | null
  ) {
    super(message)
    this.name = "ProviderError"
  }
}

/** Higgsfield's documented status codes (docs.higgsfield.ai/docs/concepts/errors). */
export function classifyProviderHttp(status: number, detail: string): ProviderErrorKind {
  if (status === 401) return "bad_credentials"
  if (status === 403) return "no_credits"
  if (status === 423 || status === 503 || status === 429) return "wait"
  // 400 is also how the concurrency limit is reported. This only decides "wait vs. give up", never
  // anything permanent, so matching the message is acceptable here.
  if (status === 400 && /concurren/i.test(detail)) return "wait"
  if (status >= 500) return "retry_same"
  return "invalid"
}

/**
 * Retry policy for failed generations, per the spec: up to 2 retries with a fresh request, then the
 * run fails. A moderation rejection gets one retry with a rewritten prompt.
 */
export const MAX_GENERATION_RETRIES = 2
export const MAX_MODERATION_RETRIES = 1

export type RetryDecision = { retry: false } | { retry: true; rewritePrompt: boolean }

export function retryDecision(status: GenerationStatus, attempt: number, moderationRetries: number): RetryDecision {
  if (status === "nsfw") return moderationRetries < MAX_MODERATION_RETRIES ? { retry: true, rewritePrompt: true } : { retry: false }
  if (status === "failed" || status === "timed_out") return attempt <= MAX_GENERATION_RETRIES ? { retry: true, rewritePrompt: false } : { retry: false }
  return { retry: false }
}
