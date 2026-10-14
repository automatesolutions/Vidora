import { asc, desc, eq, gt, inArray, lt } from "drizzle-orm"
import type { Db } from "./client"
import { getBalance } from "./credits"
import { assets, jobEvents, scheduledPosts, videoJobs, type VideoJob } from "./schema"
import { inWorkspace } from "./scoped"

// Read models for the app pages. Every query is scoped to the caller's workspace.

export type VideoListItem = Pick<
  VideoJob,
  "id" | "status" | "title" | "topic" | "videoType" | "lengthSec" | "createdAt" | "plannedPostAt" | "creditsCharged" | "isFree"
>

const listColumns = {
  id: videoJobs.id,
  status: videoJobs.status,
  title: videoJobs.title,
  topic: videoJobs.topic,
  videoType: videoJobs.videoType,
  lengthSec: videoJobs.lengthSec,
  createdAt: videoJobs.createdAt,
  plannedPostAt: videoJobs.plannedPostAt,
  creditsCharged: videoJobs.creditsCharged,
  isFree: videoJobs.isFree,
}

/** Newest first, keyset-paginated on the time-sortable job ID. */
export async function listVideos(
  db: Db,
  workspaceId: string,
  opts: { statuses?: VideoJob["status"][]; before?: string | null; limit?: number } = {}
): Promise<{ items: VideoListItem[]; nextCursor: string | null }> {
  const limit = Math.min(opts.limit ?? 24, 100)
  const rows = await db
    .select(listColumns)
    .from(videoJobs)
    .where(
      inWorkspace(
        videoJobs,
        workspaceId,
        opts.statuses?.length ? inArray(videoJobs.status, opts.statuses) : undefined,
        opts.before ? lt(videoJobs.id, opts.before) : undefined
      )
    )
    .orderBy(desc(videoJobs.id))
    .limit(limit + 1)
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null }
}

/** The queue: videos waiting for a decision, oldest first (first in, first reviewed). */
export async function listQueue(db: Db, workspaceId: string, limit = 50): Promise<VideoListItem[]> {
  return db
    .select(listColumns)
    .from(videoJobs)
    .where(inWorkspace(videoJobs, workspaceId, eq(videoJobs.status, "pending_approval")))
    .orderBy(asc(videoJobs.lastEventAt))
    .limit(limit)
}

export async function getVideo(db: Db, workspaceId: string, jobId: string) {
  const [job] = await db.select().from(videoJobs).where(inWorkspace(videoJobs, workspaceId, eq(videoJobs.id, jobId)))
  return job ?? null
}

/** Progress for the polling endpoint: the job's status plus events newer than `after` (a job event ID). */
export async function getProgress(db: Db, workspaceId: string, jobId: string, after?: string | null) {
  const job = await getVideo(db, workspaceId, jobId)
  if (!job) return null
  const events = await db
    .select({ id: jobEvents.id, event: jobEvents.event, toStatus: jobEvents.toStatus, payload: jobEvents.payload, createdAt: jobEvents.createdAt })
    .from(jobEvents)
    .where(inWorkspace(jobEvents, workspaceId, eq(jobEvents.jobId, jobId), eq(jobEvents.revision, job.revision), after ? gt(jobEvents.id, after) : undefined))
    .orderBy(asc(jobEvents.id))
    .limit(200)
  return {
    job: {
      id: job.id,
      status: job.status,
      revision: job.revision,
      version: job.version,
      currentStage: job.currentStage,
      rerunFromStage: job.revision > 1 ? job.rerunFromStage : null,
      progress: job.progress,
      errorMessage: job.errorMessage,
      isFree: job.isFree,
      creditsReserved: job.creditsReserved,
    },
    events,
  }
}

/** Assets of the job's current revision, keyed for the review page. */
export async function getReviewAssets(db: Db, workspaceId: string, job: Pick<VideoJob, "id" | "revision">) {
  const rows = await db
    .select()
    .from(assets)
    .where(inWorkspace(assets, workspaceId, eq(assets.jobId, job.id), eq(assets.revision, job.revision)))
    .orderBy(asc(assets.kind), asc(assets.ordinal))
  return {
    video: rows.find((a) => a.kind === "final_video") ?? rows.find((a) => a.kind === "preview") ?? null,
    frames: rows.filter((a) => a.kind === "thumbnail"),
  }
}

export async function getPostsForJob(db: Db, workspaceId: string, jobId: string) {
  return db
    .select()
    .from(scheduledPosts)
    .where(inWorkspace(scheduledPosts, workspaceId, eq(scheduledPosts.jobId, jobId)))
    .orderBy(desc(scheduledPosts.createdAt))
}

export async function getCredits(db: Db, workspaceId: string) {
  return getBalance(db, workspaceId)
}


