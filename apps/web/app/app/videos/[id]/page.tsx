import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { Suspense } from "react"
import { getDb, getProgress } from "@vidora/db"
import { Skeleton } from "@/components/ui/skeleton"
import { requireSession } from "@/lib/server/session"
import { Progress } from "./progress"

export const metadata: Metadata = { title: "Making your video" }

// Statuses that belong on the review page instead.
const REVIEW_STATUSES = new Set(["pending_approval", "approved", "scheduled", "publishing", "published", "partially_published", "publish_failed", "rejected"])

export default function VideoProgressPage({ params }: PageProps<"/app/videos/[id]">) {
  return (
    <Suspense fallback={<ProgressSkeleton />}>
      <VideoProgress params={params} />
    </Suspense>
  )
}

async function VideoProgress({ params }: { params: PageProps<"/app/videos/[id]">["params"] }) {
  const { id } = await params
  const s = await requireSession(`/app/videos/${id}`)
  const p = await getProgress(getDb(), s.workspaceId, id)
  if (!p) notFound()
  if (REVIEW_STATUSES.has(p.job.status)) redirect(`/app/videos/${id}/review`)
  return <Progress initial={JSON.parse(JSON.stringify(p))} />
}

function ProgressSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Skeleton className="h-10 w-2/3 bg-muted" />
      <Skeleton className="h-2 w-full bg-muted" />
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="mx-auto size-10 rounded-full bg-muted" />
        ))}
      </div>
    </div>
  )
}
