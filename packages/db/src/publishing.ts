import { MAX_PUBLISH_ATTEMPTS, nextPublishRetryDelay, rollUpPublish, transitionPost } from "@vidora/core"
import { and, asc, eq, isNull, lte, or } from "drizzle-orm"
import { markAccountNeedsReauth } from "./accounts"
import type { Db, Tx } from "./client"
import { applyJobEvent } from "./jobs"
import { assets, connectedAccounts, scheduledPosts, videoJobs, type ConnectedAccount, type VideoJob } from "./schema"

// Worker side of posting. Posts move scheduled → publishing → published / failed / needs_reauth
// (transitionPost), and the video follows through start_publish and the rolled-up result (transitionJob).

export type ClaimedPost = {
  post: typeof scheduledPosts.$inferSelect
  job: VideoJob
  account: ConnectedAccount
  videoKey: string | null
  coverKey: string | null
}

/** Takes posts that are due, marks them publishing, and moves their videos to publishing. */
export async function claimDuePosts(db: Db, now = new Date(), limit = 3): Promise<ClaimedPost[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.status, "scheduled"),
          lte(scheduledPosts.scheduledAt, now),
          or(isNull(scheduledPosts.nextAttemptAt), lte(scheduledPosts.nextAttemptAt, now))
        )
      )
      .orderBy(asc(scheduledPosts.scheduledAt))
      .limit(limit)
      .for("update", { skipLocked: true })

    const claimed: ClaimedPost[] = []
    for (const post of due) {
      const [job] = await tx.select().from(videoJobs).where(eq(videoJobs.id, post.jobId)).for("update")
      const [account] = await tx.select().from(connectedAccounts).where(eq(connectedAccounts.id, post.connectedAccountId))
      if (!job || !account) continue
      await tx
        .update(scheduledPosts)
        .set({ status: transitionPost(post.status, "start"), attemptCount: post.attemptCount + 1 })
        .where(eq(scheduledPosts.id, post.id))
      const started =
        job.status === "scheduled" || job.status === "partially_published"
          ? (await applyJobEvent(tx, job, "start_publish", { type: "system" }, { payload: { post_id: post.id } })).job
          : job
      const revision = Number(post.platformOptions.revision ?? job.revision)
      const files = await tx
        .select({ kind: assets.kind, ordinal: assets.ordinal, key: assets.storageKey })
        .from(assets)
        .where(and(eq(assets.jobId, job.id), eq(assets.revision, revision)))
      const cover = Number(post.platformOptions.coverOrdinal ?? 0)
      claimed.push({
        post: { ...post, attemptCount: post.attemptCount + 1 },
        job: started,
        account,
        videoKey: files.find((f) => f.kind === "final_video")?.key ?? null,
        coverKey: files.find((f) => f.kind === "thumbnail" && f.ordinal === cover)?.key ?? null,
      })
    }
    return claimed
  })
}

export type PublishOutcome =
  | { ok: true; externalPostId: string; externalUrl: string | null }
  | { ok: false; kind: "auth"; error: string }
  | { ok: false; kind: "retryable" | "permanent"; error: string }

/** Records one upload's result, schedules a retry if there's one left, and rolls the video's status up. */
export async function finishPost(db: Db, postId: string, outcome: PublishOutcome, now = new Date()) {
  return db.transaction(async (tx) => {
    const [post] = await tx.select().from(scheduledPosts).where(eq(scheduledPosts.id, postId)).for("update")
    if (!post || post.status !== "publishing") return null

    if (outcome.ok) {
      await tx
        .update(scheduledPosts)
        .set({
          status: transitionPost(post.status, "succeed"),
          externalPostId: outcome.externalPostId,
          externalUrl: outcome.externalUrl,
          publishedAt: now,
          lastError: null,
        })
        .where(eq(scheduledPosts.id, post.id))
    } else if (outcome.kind === "auth") {
      await tx.update(scheduledPosts).set({ status: transitionPost(post.status, "auth_failed"), lastError: outcome.error }).where(eq(scheduledPosts.id, post.id))
      await markAccountNeedsReauth(tx, post.connectedAccountId)
    } else {
      const delay = outcome.kind === "retryable" && post.attemptCount < MAX_PUBLISH_ATTEMPTS ? nextPublishRetryDelay(post.attemptCount) : null
      const failed = transitionPost(post.status, "fail")
      await tx
        .update(scheduledPosts)
        .set(
          delay === null
            ? { status: failed, lastError: outcome.error }
            : { status: transitionPost(failed, "retry"), lastError: outcome.error, nextAttemptAt: new Date(now.getTime() + delay) }
        )
        .where(eq(scheduledPosts.id, post.id))
    }
    return rollUp(tx, post.jobId)
  })
}

async function rollUp(tx: Tx, jobId: string) {
  const posts = await tx.select({ status: scheduledPosts.status }).from(scheduledPosts).where(eq(scheduledPosts.jobId, jobId))
  const event = rollUpPublish(posts.map((p) => p.status))
  if (!event) return null
  const [job] = await tx.select().from(videoJobs).where(eq(videoJobs.id, jobId)).for("update")
  if (!job || job.status !== "publishing") return null
  return (await applyJobEvent(tx, job, event, { type: "system" })).job.status
}
