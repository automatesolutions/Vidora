// Video job and post state machines. Pure functions: callers persist the result and apply the effects.
// Every status change in the app goes through `transitionJob` / `transitionPost` (see docs/PLAN.md).

export const JOB_STATUSES = [
  "queued",
  "generating",
  "pending_approval",
  "changes_requested",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "partially_published",
  "publish_failed",
  "rejected",
  "generation_failed",
  "canceled",
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const JOB_EVENTS = [
  "claim", // n8n started this revision
  "complete", // n8n finished, video ready for review
  "fail", // n8n reported a failure or the reconciler gave up
  "retry", // run the same revision again
  "approve",
  "reject",
  "request_changes",
  "requeue", // start the next revision after changes were requested
  "undo_approve",
  "undo_reject",
  "schedule", // posts were created for the approved video
  "unschedule", // creator pulled it back to edit
  "start_publish",
  "publish_done",
  "publish_partial",
  "publish_fail",
  "retry_publish",
  "cancel",
] as const
export type JobEvent = (typeof JOB_EVENTS)[number]

// Side effects the caller must apply in the same transaction as the status change.
export type JobEffect =
  | "charge_credits" // turn the reservation into a charge
  | "release_credits" // return the reservation
  | "bump_revision" // revision + 1 for the next generation run
  | "reserve_credits" // reserve credits for a paid change request
  | "dispatch_generation" // enqueue the n8n trigger
  | "notify_review" // tell reviewers a video is waiting
  | "notify_failure"
  | "create_posts"
  | "cancel_posts"

type Rule = { from: readonly JobStatus[]; to: JobStatus; effects?: readonly JobEffect[] }

const JOB_RULES: Record<JobEvent, Rule> = {
  claim: { from: ["queued"], to: "generating" },
  complete: { from: ["generating"], to: "pending_approval", effects: ["charge_credits", "notify_review"] },
  fail: { from: ["queued", "generating"], to: "generation_failed", effects: ["release_credits", "notify_failure"] },
  retry: { from: ["generation_failed"], to: "queued", effects: ["reserve_credits", "dispatch_generation"] },
  approve: { from: ["pending_approval"], to: "approved", effects: ["create_posts"] },
  reject: { from: ["pending_approval"], to: "rejected" },
  request_changes: { from: ["pending_approval"], to: "changes_requested" },
  requeue: { from: ["changes_requested"], to: "queued", effects: ["bump_revision", "reserve_credits", "dispatch_generation"] },
  undo_approve: { from: ["approved", "scheduled"], to: "pending_approval", effects: ["cancel_posts"] },
  undo_reject: { from: ["rejected"], to: "pending_approval" },
  schedule: { from: ["approved"], to: "scheduled" },
  unschedule: { from: ["scheduled"], to: "pending_approval", effects: ["cancel_posts"] },
  start_publish: { from: ["scheduled", "partially_published"], to: "publishing" },
  publish_done: { from: ["publishing"], to: "published" },
  publish_partial: { from: ["publishing"], to: "partially_published", effects: ["notify_failure"] },
  publish_fail: { from: ["publishing"], to: "publish_failed", effects: ["notify_failure"] },
  retry_publish: { from: ["publish_failed", "partially_published"], to: "scheduled" },
  cancel: {
    from: ["queued", "generation_failed", "pending_approval", "changes_requested", "approved", "scheduled"],
    to: "canceled",
    effects: ["release_credits", "cancel_posts"],
  },
}

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["published", "canceled"]

export class TransitionError extends Error {
  constructor(
    readonly from: string,
    readonly event: string
  ) {
    super(`Can't apply "${event}" to a video that is "${from}"`)
    this.name = "TransitionError"
  }
}

export function canTransitionJob(from: JobStatus, event: JobEvent) {
  return JOB_RULES[event].from.includes(from)
}

export function transitionJob(from: JobStatus, event: JobEvent): { to: JobStatus; effects: readonly JobEffect[] } {
  const rule = JOB_RULES[event]
  if (!rule.from.includes(from)) throw new TransitionError(from, event)
  // release_credits on cancel only applies while credits are still reserved (before the charge).
  const effects =
    event === "cancel" && !["queued", "generation_failed", "changes_requested"].includes(from)
      ? (rule.effects ?? []).filter((e) => e !== "release_credits")
      : (rule.effects ?? [])
  return { to: rule.to, effects }
}

/** Events a reviewer can trigger from the current status (drives which buttons show). */
export function availableJobEvents(from: JobStatus): JobEvent[] {
  return JOB_EVENTS.filter((e) => JOB_RULES[e].from.includes(from))
}

// ── Posts (one per video × connected account) ───────────────────────────────

export const POST_STATUSES = ["scheduled", "publishing", "published", "failed", "needs_reauth", "canceled"] as const
export type PostStatus = (typeof POST_STATUSES)[number]
export type PostEvent = "start" | "succeed" | "fail" | "auth_failed" | "retry" | "cancel"

const POST_RULES: Record<PostEvent, { from: readonly PostStatus[]; to: PostStatus }> = {
  start: { from: ["scheduled"], to: "publishing" },
  succeed: { from: ["publishing"], to: "published" },
  fail: { from: ["publishing"], to: "failed" },
  auth_failed: { from: ["publishing", "scheduled"], to: "needs_reauth" },
  retry: { from: ["failed", "needs_reauth"], to: "scheduled" },
  cancel: { from: ["scheduled", "failed", "needs_reauth"], to: "canceled" },
}

export function transitionPost(from: PostStatus, event: PostEvent): PostStatus {
  const rule = POST_RULES[event]
  if (!rule.from.includes(from)) throw new TransitionError(from, event)
  return rule.to
}

/** Backoff for publish retries: 1 min, 5 min, 30 min, 2 h, then stop (null). */
const PUBLISH_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000]
export const MAX_PUBLISH_ATTEMPTS = PUBLISH_BACKOFF_MS.length + 1

export function nextPublishRetryDelay(attemptsSoFar: number): number | null {
  return PUBLISH_BACKOFF_MS[attemptsSoFar - 1] ?? null
}

/** Rolls the per-post results up into the job event to apply once publishing ends. */
export function rollUpPublish(results: PostStatus[]): "publish_done" | "publish_partial" | "publish_fail" | null {
  const live = results.filter((s) => s !== "canceled")
  if (live.length === 0 || live.some((s) => s === "scheduled" || s === "publishing")) return null
  const ok = live.filter((s) => s === "published").length
  if (ok === live.length) return "publish_done"
  return ok > 0 ? "publish_partial" : "publish_fail"
}
