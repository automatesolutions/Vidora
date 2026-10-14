import { FREE_CHANGE_REQUESTS, formatPostTime, normalizeHashtags, suggestPostTime } from "@vidora/core"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { Suspense } from "react"
import { accountForDisplay, getActiveAccount, getDb, getPostsForJob, getReviewAssets, getVideo, getWorkspace, jobBaseCredits } from "@vidora/db"
import { Skeleton } from "@/components/ui/skeleton"
import { canReview, requireSession } from "@/lib/server/session"
import { getStorage } from "@/lib/server/storage"
import { ReviewForm } from "./review-form"

export const metadata: Metadata = { title: "Review video" }

const GENERATING = new Set(["queued", "generating", "changes_requested", "generation_failed", "canceled"])

export default function ReviewPage({ params }: PageProps<"/app/videos/[id]/review">) {
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <Review params={params} />
    </Suspense>
  )
}

async function Review({ params }: { params: PageProps<"/app/videos/[id]/review">["params"] }) {
  const { id } = await params
  const s = await requireSession(`/app/videos/${id}/review`)
  const db = getDb()
  const job = await getVideo(db, s.workspaceId, id)
  if (!job) notFound()
  if (GENERATING.has(job.status)) redirect(`/app/videos/${id}`)

  const [workspace, account, files, posts] = await Promise.all([
    getWorkspace(db, s.workspaceId),
    getActiveAccount(db, s.workspaceId, "youtube"),
    getReviewAssets(db, s.workspaceId, job),
    getPostsForJob(db, s.workspaceId, id),
  ])
  const storage = getStorage()
  const timeZone = workspace?.timezone ?? "UTC"
  const lengthSec = job.lengthSec ?? Math.round((files.video?.durationMs ?? 15000) / 1000)
  const frames = await Promise.all(
    files.frames.map(async (f) => ({
      ordinal: f.ordinal,
      url: await storage.presignGet(f.storageKey),
      atSec: Math.round((lengthSec * (f.ordinal + 0.5)) / Math.max(files.frames.length, 1)),
    }))
  )
  const suggested = nextPostTime(job.plannedPostAt, timeZone)
  const post = posts.find((p) => p.status !== "canceled") ?? null

  return (
    <ReviewForm
      job={{
        id: job.id,
        status: job.status,
        revision: job.revision,
        title: job.title ?? "",
        description: job.caption ?? "",
        hashtags: normalizeHashtags(job.hashtags),
        visibility: job.visibility,
        madeForKids: job.madeForKids,
        coverOrdinal: job.coverOrdinal,
        creditsCharged: job.creditsCharged,
        isFree: job.isFree,
        baseCredits: jobBaseCredits(job),
        freeChangesLeft: Math.max(0, FREE_CHANGE_REQUESTS - job.changeRequestCount),
        changeRequestCount: job.changeRequestCount,
      }}
      video={files.video ? await storage.presignGet(files.video.storageKey, { expiresSec: 3600 }) : null}
      frames={frames}
      channel={account ? accountForDisplay(account) : null}
      post={
        post
          ? {
              status: post.status,
              scheduledAt: post.scheduledAt.toISOString(),
              label: formatPostTime(post.scheduledAt, timeZone),
              externalUrl: post.externalUrl,
              lastError: post.lastError,
            }
          : null
      }
      suggestedPostAt={suggested.toISOString()}
      suggestedLabel={formatPostTime(suggested, timeZone)}
      timeZone={timeZone}
      audited={process.env.YOUTUBE_AUDITED === "true"}
      canReview={canReview(s)}
    />
  )
}

/** The saved post time if it's still ahead, otherwise a fresh suggestion. */
function nextPostTime(planned: Date | null, timeZone: string) {
  return planned && planned.getTime() > Date.now() ? planned : suggestPostTime(timeZone)
}

function ReviewSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="grid gap-8 lg:grid-cols-[360px_1fr]">
      <Skeleton className="mx-auto aspect-[9/16] w-full max-w-[360px] bg-muted" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-2/3 bg-muted" />
        <Skeleton className="h-12 w-full bg-muted" />
        <Skeleton className="h-32 w-full bg-muted" />
        <Skeleton className="h-12 w-full bg-muted" />
      </div>
    </div>
  )
}
