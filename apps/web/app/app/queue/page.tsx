import { Inbox, Sparkles } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { getDb, getWorkspace, listQueue } from "@vidora/db"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/vidora/empty-state"
import { VideoList } from "@/components/vidora/video-list"
import { requireSession } from "@/lib/server/session"

export const metadata: Metadata = { title: "Review queue" }

export default function QueuePage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-md">Review queue</h1>
        <p className="text-body-md text-muted-foreground">Videos waiting for you. Nothing posts until you approve it.</p>
      </div>
      <Suspense fallback={<QueueSkeleton />}>
        <Queue />
      </Suspense>
    </div>
  )
}

async function Queue() {
  const s = await requireSession("/app/queue")
  const db = getDb()
  const [items, ws] = await Promise.all([listQueue(db, s.workspaceId), getWorkspace(db, s.workspaceId)])
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing to review right now"
        body="Videos show up here when they're ready for you."
        action={
          <Button asChild>
            <Link href="/app/new">
              <Sparkles aria-hidden />
              Make a video now
            </Link>
          </Button>
        }
      />
    )
  }
  return <VideoList videos={items} timeZone={ws?.timezone ?? "UTC"} label="Videos waiting for review, oldest first" />
}

function QueueSkeleton() {
  return (
    <div role="status" aria-label="Loading queue" className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-20 rounded-md bg-muted" />
      ))}
    </div>
  )
}
