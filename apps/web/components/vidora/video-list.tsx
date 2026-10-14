import type { VideoType } from "@vidora/core/brief"
import { formatPostTime } from "@vidora/core/youtube"
import { Camera, ChevronRight, Film, Lightbulb, Quote, ShoppingBag, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { StatusPill, type VideoStatus } from "@/components/vidora/status-pill"
import { VIDEO_TYPE_LABELS } from "@/lib/labels"

// Rows for /app/videos and /app/queue. The whole row is one link; nothing decorative (design skill §5).

export type VideoRowData = {
  id: string
  status: string
  title: string | null
  topic: string | null
  videoType: VideoType | null
  lengthSec: number | null
  createdAt: Date
  plannedPostAt: Date | null
}

const TYPE_ICONS: Record<VideoType, LucideIcon> = { fact_tip: Lightbulb, product_showcase: ShoppingBag, photo_to_life: Camera, quote: Quote }
const REVIEW = new Set(["pending_approval", "approved", "scheduled", "publishing", "published", "publish_failed", "partially_published", "rejected"])

function when(v: VideoRowData, timeZone: string) {
  if ((v.status === "scheduled" || v.status === "approved") && v.plannedPostAt) return `Posting ${formatPostTime(v.plannedPostAt, timeZone)}`
  const d = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(v.createdAt)
  return `Made ${d}`
}

export function VideoList({ videos, timeZone, label }: { videos: VideoRowData[]; timeZone: string; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {videos.map((v) => {
        const Icon = v.videoType ? TYPE_ICONS[v.videoType] : Film
        const name = v.title || v.topic || (v.videoType ? VIDEO_TYPE_LABELS[v.videoType].label : "Video")
        const meta = [v.videoType ? VIDEO_TYPE_LABELS[v.videoType].label : null, v.lengthSec ? `${v.lengthSec} s` : null, when(v, timeZone)]
          .filter(Boolean)
          .join(" · ")
        return (
          <li key={v.id}>
            <Link
              href={REVIEW.has(v.status) ? `/app/videos/${v.id}/review` : `/app/videos/${v.id}`}
              className="flex min-h-20 items-center gap-4 rounded-md bg-card p-4 transition-colors hover:bg-accent"
            >
              <span aria-hidden className="flex aspect-[9/16] w-11 shrink-0 items-center justify-center rounded-sm bg-background text-foreground">
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-body-sm-strong text-foreground">{name}</span>
                <span className="tabular truncate text-caption text-muted-foreground">{meta}</span>
              </span>
              <StatusPill status={v.status as VideoStatus} className="shrink-0 max-sm:hidden" />
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className="sr-only">, {v.status.replace(/_/g, " ")}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
