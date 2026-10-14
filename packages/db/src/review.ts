import {
  CHANGE_TARGETS,
  buildDescription,
  changeRequestCost,
  newId,
  normalizeHashtags,
  rerunFromStage,
  transitionPost,
  type ChangeTarget,
  type ReviewDetails,
} from "@vidora/core"
import { and, eq, inArray } from "drizzle-orm"
import { getActiveAccount } from "./accounts"
import type { Db, Tx } from "./client"
import { applyJobEvent, jobBaseCredits, lockJobInWorkspace, type Actor } from "./jobs"
import { approvals, jobEvents, scheduledPosts, videoJobs, type VideoJob } from "./schema"

// Creator decisions on the review page. Every status change goes through applyJobEvent (transitionJob +
// job_events). Every function is scoped to the caller's workspace.

export class JobNotFoundError extends Error {
  constructor() {
    super("We couldn't find that video.")
    this.name = "JobNotFoundError"
  }
}

/** Approve needs somewhere to post. The review page answers this by opening the connect dialog. */
export class NeedsConnectionError extends Error {
  constructor(readonly platform: "youtube") {
    super("Connect YouTube to approve this video.")
    this.name = "NeedsConnectionError"
  }
}

export class StaleJobError extends Error {
  constructor() {
    super("This video changed while you were away. Check it and approve again.")
    this.name = "StaleJobError"
  }
}

async function withJob<T>(db: Db, workspaceId: string, jobId: string, fn: (tx: Tx, job: VideoJob) => Promise<T>) {
  return db.transaction(async (tx) => {
    const job = await lockJobInWorkspace(tx, workspaceId, jobId)
    if (!job) throw new JobNotFoundError()
    return fn(tx, job)
  })
}

const detailsPatch = (d: ReviewDetails & { plannedPostAt?: Date | null }) => ({
  title: d.title,
  caption: d.description,
  hashtags: normalizeHashtags(d.hashtags),
  visibility: d.visibility,
  madeForKids: d.madeForKids,
  coverOrdinal: d.coverOrdinal,
  ...(d.plannedPostAt !== undefined ? { plannedPostAt: d.plannedPostAt } : {}),
})

/** Saves the editable YouTube details. Only while the video waits for review. Logged, no status change. */
export async function updateReviewDetails(
  db: Db,
  input: { workspaceId: string; jobId: string; actor: Actor; details: ReviewDetails; plannedPostAt?: Date | null }
) {
  return withJob(db, input.workspaceId, input.jobId, async (tx, job) => {
    if (job.status !== "pending_approval") throw new StaleJobError()
    const patch = detailsPatch({ ...input.details, plannedPostAt: input.plannedPostAt })
    const changed = Object.keys(patch).filter((k) => JSON.stringify(patch[k as keyof typeof patch]) !== JSON.stringify(job[k as keyof VideoJob]))
    if (changed.length === 0) return job
    const [updated] = await tx.update(videoJobs).set(patch).where(eq(videoJobs.id, job.id)).returning()
    await tx.insert(jobEvents).values({
      id: newId("jobEvent"),
      workspaceId: job.workspaceId,
      jobId: job.id,
      revision: job.revision,
      event: "details_edited",
      fromStatus: job.status,
      toStatus: job.status,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      payload: { fields: changed },
    })
    return updated!
  })
}

/**
 * Approves a video and schedules its YouTube post, in one transaction: approve → create_posts → schedule.
 * `expectedVersion` comes back from the Google connect round trip, so a video that changed meanwhile isn't approved.
 */
export async function approveJob(
  db: Db,
  input: {
    workspaceId: string
    jobId: string
    actor: Actor
    postAt: Date
    details?: ReviewDetails
    expectedVersion?: number
    now?: Date
  }
) {
  return withJob(db, input.workspaceId, input.jobId, async (tx, job) => {
    if (input.expectedVersion !== undefined && job.version !== input.expectedVersion) throw new StaleJobError()
    const account = await getActiveAccount(tx, input.workspaceId, "youtube")
    if (!account) throw new NeedsConnectionError("youtube")

    const now = input.now ?? new Date()
    const postAt = input.postAt.getTime() < now.getTime() ? now : input.postAt
    const details = input.details ? detailsPatch(input.details) : {}
    const approved = await applyJobEvent(tx, job, "approve", input.actor, {
      patch: { ...details, plannedPostAt: postAt },
      payload: { post_at: postAt.toISOString(), account_id: account.id },
    })
    const j = approved.job

    let postId: string | null = null
    if (approved.effects.includes("create_posts")) {
      postId = newId("post")
      await tx.insert(scheduledPosts).values({
        id: postId,
        workspaceId: j.workspaceId,
        jobId: j.id,
        connectedAccountId: account.id,
        platform: "youtube",
        scheduledAt: postAt,
        title: j.title,
        caption: buildDescription(j.caption ?? "", j.hashtags),
        hashtags: normalizeHashtags(j.hashtags),
        platformOptions: {
          visibility: j.visibility,
          madeForKids: j.madeForKids,
          containsSyntheticMedia: true,
          coverOrdinal: j.coverOrdinal,
          revision: j.revision,
        },
        // version changes on every status change, so approve → undo → approve gets a new key.
        idempotencyKey: `${j.id}:r${j.revision}:${account.id}:v${j.version}`,
      })
    }
    await tx.insert(approvals).values({
      id: newId("approval"),
      workspaceId: j.workspaceId,
      jobId: j.id,
      revision: j.revision,
      reviewerId: input.actor.type === "user" ? (input.actor.id ?? null) : null,
      decision: "approved",
    })
    const scheduled = await applyJobEvent(tx, j, "schedule", { type: "system" }, { payload: { post_id: postId } })
    return { job: scheduled.job, postId, postAt }
  })
}

async function cancelOpenPosts(tx: Tx, jobId: string) {
  const posts = await tx
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.jobId, jobId), inArray(scheduledPosts.status, ["scheduled", "failed", "needs_reauth"])))
  for (const p of posts) {
    const to = transitionPost(p.status, "cancel")
    await tx.update(scheduledPosts).set({ status: to }).where(eq(scheduledPosts.id, p.id))
  }
}

/** Undo for "Approved. Posting {time}." Puts the video back in review and cancels its post. */
export async function undoApprove(db: Db, input: { workspaceId: string; jobId: string; actor: Actor }) {
  return withJob(db, input.workspaceId, input.jobId, async (tx, job) => {
    const r = await applyJobEvent(tx, job, "undo_approve", input.actor)
    if (r.effects.includes("cancel_posts")) await cancelOpenPosts(tx, job.id)
    return r.job
  })
}

export async function rejectJob(db: Db, input: { workspaceId: string; jobId: string; actor: Actor }) {
  return withJob(db, input.workspaceId, input.jobId, async (tx, job) => {
    const r = await applyJobEvent(tx, job, "reject", input.actor)
    await tx.insert(approvals).values({
      id: newId("approval"),
      workspaceId: job.workspaceId,
      jobId: job.id,
      revision: job.revision,
      reviewerId: input.actor.id ?? null,
      decision: "rejected",
    })
    return r.job
  })
}

export async function undoReject(db: Db, input: { workspaceId: string; jobId: string; actor: Actor }) {
  return withJob(db, input.workspaceId, input.jobId, async (tx, job) => (await applyJobEvent(tx, job, "undo_reject", input.actor)).job)
}

/**
 * "Request changes": records the feedback, then starts the next revision from the earliest picked part
 * (request_changes → requeue). The first two per video are free; after that the rerun is priced by stage.
 */
export async function requestChanges(
  db: Db,
  input: { workspaceId: string; jobId: string; actor: Actor; targets: ChangeTarget[]; text: string }
) {
  const targets = [...new Set(input.targets)].filter((t): t is ChangeTarget => t in CHANGE_TARGETS)
  const fromStage = rerunFromStage(targets)
  return withJob(db, input.workspaceId, input.jobId, async (tx, job) => {
    const cost = changeRequestCost(jobBaseCredits(job), fromStage, job.changeRequestCount)
    const feedback = { targets, text: input.text.trim().slice(0, 2000) }
    const asked = await applyJobEvent(tx, job, "request_changes", input.actor, {
      patch: { feedback, rerunFromStage: fromStage, changeRequestCount: job.changeRequestCount + 1 },
      payload: { targets, rerun_from_stage: fromStage, credits: cost },
    })
    await tx.insert(approvals).values({
      id: newId("approval"),
      workspaceId: job.workspaceId,
      jobId: job.id,
      revision: job.revision,
      reviewerId: input.actor.id ?? null,
      decision: "changes_requested",
      changeTargets: targets,
      feedback: feedback.text,
      creditsCost: cost,
    })
    // Throws InsufficientCreditsError when a paid change can't be covered; the whole request rolls back.
    const requeued = await applyJobEvent(tx, asked.job, "requeue", { type: "system" }, { reserveCredits: cost })
    return { job: requeued.job, credits: cost, fromStage }
  })
}

/** "Try again" after a failed generation. Same price as the first try (free for the free video). */
export async function retryGeneration(db: Db, input: { workspaceId: string; jobId: string; actor: Actor }) {
  return withJob(db, input.workspaceId, input.jobId, async (tx, job) => (await applyJobEvent(tx, job, "retry", input.actor)).job)
}

/**
 * After a creator reconnects an expired YouTube login: posts that stopped with `needs_reauth` go back to
 * `scheduled` (posting now), and their videos move from publish_failed back to scheduled.
 */
export async function retryPostsAfterReconnect(db: Db, workspaceId: string, accountId: string) {
  return db.transaction(async (tx) => {
    const posts = await tx
      .select()
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.workspaceId, workspaceId), eq(scheduledPosts.connectedAccountId, accountId), eq(scheduledPosts.status, "needs_reauth")))
      .for("update")
    for (const p of posts) {
      await tx
        .update(scheduledPosts)
        .set({ status: transitionPost(p.status, "retry"), attemptCount: 0, nextAttemptAt: null, lastError: null, scheduledAt: new Date() })
        .where(eq(scheduledPosts.id, p.id))
      const job = await lockJobInWorkspace(tx, workspaceId, p.jobId)
      if (job && (job.status === "publish_failed" || job.status === "partially_published")) {
        await applyJobEvent(tx, job, "retry_publish", { type: "system" }, { payload: { reason: "reconnected", post_id: p.id } })
      }
    }
    return posts.length
  })
}
