import { Plus, Sparkles, Video } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { getDb, getWorkspace, listVideos } from "@vidora/db"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/vidora/empty-state"
import { VideoList } from "@/components/vidora/video-list"
import { requireSession } from "@/lib/server/session"

export const metadata: Metadata = { title: "Videos" }

export default function VideosPage({ searchParams }: PageProps<"/app/videos">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-display-md">Videos</h1>
        <Button asChild>
          <Link href="/app/new">
            <Plus aria-hidden />
            Make a video
          </Link>
        </Button>
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <Videos searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Videos({ searchParams }: { searchParams: PageProps<"/app/videos">["searchParams"] }) {
  const s = await requireSession("/app/videos")
  const before = (await searchParams).before
  const db = getDb()
  const [{ items, nextCursor }, ws] = await Promise.all([
    listVideos(db, s.workspaceId, { before: typeof before === "string" ? before : null }),
    getWorkspace(db, s.workspaceId),
  ])
  if (items.length === 0 && !before) {
    return (
      <EmptyState
        icon={Video}
        title="No videos yet"
        body="Make your first video. It's free, and you review it before anything posts."
        action={
          <Button variant="secondary" asChild>
            <Link href="/app/new">
              <Sparkles aria-hidden />
              Make your first video
            </Link>
          </Button>
        }
      />
    )
  }
  return (
    <>
      <VideoList videos={items} timeZone={ws?.timezone ?? "UTC"} label="Your videos, newest first" />
      {nextCursor && (
        <Button variant="tertiary" asChild className="self-center">
          <Link href={`/app/videos?before=${nextCursor}`}>Show older videos</Link>
        </Button>
      )}
    </>
  )
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading videos" className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 rounded-md bg-card p-4">
          <Skeleton className="aspect-[9/16] w-11 rounded-sm bg-mute/50 dark:bg-mute/20" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <Skeleton className="h-4 w-3/4 bg-mute/50 dark:bg-mute/20" />
            <Skeleton className="h-4 w-1/2 bg-mute/50 dark:bg-mute/20" />
          </div>
        </div>
      ))}
    </div>
  )
}
