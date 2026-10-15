import { getDb, listAwaitingApproval } from "@vidora/db"
import { Inbox } from "lucide-react"
import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/vidora/empty-state"
import { VideoCard } from "@/components/vidora/video-card"
import { requireSession } from "@/lib/server/session"
import { getStorage } from "@/lib/server/storage"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/vidora/inline-alert"
import Link from "next/link"

// Approval queue: only campaigns set to "Ask me first" send videos here.
export default function ApprovalsPage({ searchParams }: PageProps<"/app/approvals">) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-md">Approvals</h1>
        <p className="text-body-md text-muted-foreground">Every video from a campaign set to ask you first waits here. Open one to review it and schedule it on YouTube.</p>
      </div>
      <Suspense>
        <Notice searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[480px] w-full bg-muted" />}>
        <Queue />
      </Suspense>
    </div>
  )
}

async function Notice({ searchParams }: Pick<PageProps<"/app/approvals">, "searchParams">) {
  const p = await searchParams
  if (typeof p.approved === "string") {
    const when = new Date(p.approved).toLocaleString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    return <InlineAlert tone="success" title="Approved">It uploads to YouTube now and goes public {when}.</InlineAlert>
  }
  if (p.rejected === "1") return <InlineAlert tone="info" title="Rejected">We won&apos;t post that video. The campaign keeps its schedule.</InlineAlert>
  return null
}

async function Queue() {
  const s = await requireSession("/app/approvals")
  const rows = await listAwaitingApproval(getDb(), s.workspaceId)
  if (rows.length === 0) return <EmptyState icon={Inbox} title="Nothing to approve" body="Campaigns set to post automatically never wait here." />
  const storage = getStorage()
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {await Promise.all(
        rows.map(async ({ run, video, campaignName }) => {
          const postLabel = run.slotAt.toLocaleString("en-US", { timeZone: "Asia/Manila", weekday: "short", hour: "numeric", minute: "2-digit" })
          return (
            <li key={run.id}>
              <VideoCard
                src={video.storageKey ? await storage.presignGet(video.storageKey, { expiresSec: 3600 }) : null}
                poster={video.thumbnailKey ? await storage.presignGet(video.thumbnailKey, { expiresSec: 3600 }) : null}
                title={video.title ?? "Untitled Short"}
                campaign={campaignName}
                status="ready"
                detail={run.plan?.hook ? `Hook: ${run.plan.hook}` : undefined}
              >
                <Button asChild size="sm">
                  <Link href={`/app/approvals/${run.id}`}>Review for {postLabel}</Link>
                </Button>
              </VideoCard>
            </li>
          )
        })
      )}
    </ul>
  )
}
