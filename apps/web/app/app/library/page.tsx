import { VIDEO_STATUSES } from "@vidora/core/campaign"
import { getDb, listVideos } from "@vidora/db"
import { Film } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/vidora/empty-state"
import { VIDEO_STATUS } from "@/components/vidora/run-status"
import { VideoCard } from "@/components/vidora/video-card"
import { requireSession } from "@/lib/server/session"
import { getStorage } from "@/lib/server/storage"
import { cn } from "@/lib/utils"

type Tab = (typeof VIDEO_STATUSES)[number]

export default function LibraryPage({ searchParams }: PageProps<"/app/library">) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-md">Video Library</h1>
        <p className="text-body-md text-muted-foreground">Every Short your campaigns made, newest first.</p>
      </div>
      <Suspense fallback={<Skeleton className="h-[480px] w-full bg-muted" />}>
        <Library searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Library({ searchParams }: Pick<PageProps<"/app/library">, "searchParams">) {
  const s = await requireSession("/app/library")
  const raw = (await searchParams).status
  const tab = (VIDEO_STATUSES as readonly string[]).includes(String(raw)) ? (raw as Tab) : null
  const rows = await listVideos(getDb(), s.workspaceId, { status: tab ?? undefined })
  const storage = getStorage()

  return (
    <>
      <nav aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto">
        {[null, ...VIDEO_STATUSES].map((t) => (
          <Link
            key={t ?? "all"}
            href={t ? `/app/library?status=${t}` : "/app/library"}
            aria-current={t === tab ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-body-sm transition-colors",
              t === tab ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t ? VIDEO_STATUS[t]!.label : "All"}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={Film} title="No videos here yet" body={tab ? "Nothing with this status right now." : "Start a campaign or press Run now on one. Finished Shorts land here."} />
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {await Promise.all(
            rows.map(async ({ video: v, run, campaignName }) => (
              <li key={v.id}>
                <VideoCard
                  src={v.storageKey ? await storage.presignGet(v.storageKey, { expiresSec: 3600 }) : null}
                  poster={v.thumbnailKey ? await storage.presignGet(v.thumbnailKey, { expiresSec: 3600 }) : null}
                  title={v.title ?? "Untitled Short"}
                  campaign={campaignName}
                  status={v.status}
                  youtubeUrl={v.youtubeUrl}
                  detail={[
                    v.durationMs ? `${Math.round(v.durationMs / 1000)} s` : null,
                    `posts ${(v.publishAt ?? run.slotAt).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </li>
            ))
          )}
        </ul>
      )}
    </>
  )
}
