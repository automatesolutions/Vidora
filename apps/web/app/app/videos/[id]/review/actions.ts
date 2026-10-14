"use server"

import {
  CHANGE_TARGETS,
  InsufficientCreditsError,
  ReviewDetailsSchema,
  TransitionError,
  type ChangeTarget,
} from "@vidora/core"
import {
  approveJob,
  ConcurrentUpdateError,
  getDb,
  JobNotFoundError,
  NeedsConnectionError,
  rejectJob,
  requestChanges,
  StaleJobError,
  undoApprove,
  undoReject,
  updateReviewDetails,
} from "@vidora/db"
import { z } from "zod"
import { canReview, getAppSession, type AppSession } from "@/lib/server/session"

export type ReviewResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; needsConnection?: true }

const PostAt = z.iso.datetime({ offset: true }).transform((s) => new Date(s))

async function reviewer(): Promise<AppSession | { ok: false; error: string }> {
  const s = await getAppSession()
  if (!s) return { ok: false, error: "Sign in again to review this video." }
  if (!canReview(s)) return { ok: false, error: "Viewers can watch videos but can't review them." }
  return s
}

/** Maps the expected failures to copy that says what happened and what to do next. */
function explain(err: unknown): ReviewResult {
  if (err instanceof NeedsConnectionError) return { ok: false, error: err.message, needsConnection: true }
  if (err instanceof InsufficientCreditsError) return { ok: false, error: `${err.message} Add credits, or approve this version.` }
  if (err instanceof StaleJobError || err instanceof ConcurrentUpdateError || err instanceof TransitionError) {
    return { ok: false, error: "This video changed in another tab. Reload the page to see the latest version." }
  }
  if (err instanceof JobNotFoundError) return { ok: false, error: err.message }
  throw err
}

export async function saveDetailsAction(jobId: string, details: unknown, postAt: string | null): Promise<ReviewResult> {
  const s = await reviewer()
  if ("ok" in s) return s
  const parsed = ReviewDetailsSchema.safeParse(details)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." }
  const at = postAt ? PostAt.safeParse(postAt) : null
  try {
    await updateReviewDetails(getDb(), {
      workspaceId: s.workspaceId,
      jobId,
      actor: { type: "user", id: s.userId },
      details: parsed.data,
      plannedPostAt: at?.success ? at.data : undefined,
    })
    return { ok: true }
  } catch (err) {
    return explain(err)
  }
}

export async function approveAction(jobId: string, details: unknown, postAt: string): Promise<ReviewResult<{ postAt: string }>> {
  const s = await reviewer()
  if ("ok" in s) return s
  const parsed = ReviewDetailsSchema.safeParse(details)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." }
  const at = PostAt.safeParse(postAt)
  if (!at.success) return { ok: false, error: "Pick a post time." }
  try {
    const r = await approveJob(getDb(), {
      workspaceId: s.workspaceId,
      jobId,
      actor: { type: "user", id: s.userId },
      postAt: at.data,
      details: parsed.data,
    })
    return { ok: true, postAt: r.postAt.toISOString() }
  } catch (err) {
    return explain(err) as ReviewResult<{ postAt: string }>
  }
}

export async function undoApproveAction(jobId: string): Promise<ReviewResult> {
  const s = await reviewer()
  if ("ok" in s) return s
  try {
    await undoApprove(getDb(), { workspaceId: s.workspaceId, jobId, actor: { type: "user", id: s.userId } })
    return { ok: true }
  } catch (err) {
    if (err instanceof TransitionError) return { ok: false, error: "It's already posting, so it can't be undone here." }
    return explain(err)
  }
}

export async function rejectAction(jobId: string): Promise<ReviewResult> {
  const s = await reviewer()
  if ("ok" in s) return s
  try {
    await rejectJob(getDb(), { workspaceId: s.workspaceId, jobId, actor: { type: "user", id: s.userId } })
    return { ok: true }
  } catch (err) {
    return explain(err)
  }
}

export async function undoRejectAction(jobId: string): Promise<ReviewResult> {
  const s = await reviewer()
  if ("ok" in s) return s
  try {
    await undoReject(getDb(), { workspaceId: s.workspaceId, jobId, actor: { type: "user", id: s.userId } })
    return { ok: true }
  } catch (err) {
    return explain(err)
  }
}

const Targets = z.array(z.enum(Object.keys(CHANGE_TARGETS) as [ChangeTarget, ...ChangeTarget[]])).min(1, "Pick at least one part to change.")

export async function requestChangesAction(jobId: string, targets: unknown, text: string): Promise<ReviewResult<{ credits: number }>> {
  const s = await reviewer()
  if ("ok" in s) return s
  const t = Targets.safeParse(targets)
  if (!t.success) return { ok: false, error: t.error.issues[0]?.message ?? "Pick at least one part to change." }
  try {
    const r = await requestChanges(getDb(), {
      workspaceId: s.workspaceId,
      jobId,
      actor: { type: "user", id: s.userId },
      targets: t.data,
      text: String(text ?? ""),
    })
    return { ok: true, credits: r.credits }
  } catch (err) {
    return explain(err) as ReviewResult<{ credits: number }>
  }
}
