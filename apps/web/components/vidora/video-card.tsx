import { ExternalLink } from "lucide-react"
import { StatusBadge, VIDEO_STATUS } from "@/components/vidora/run-status"

// ⊕ Video card: a vertical player (signed storage URL) with the title, campaign, status, and post time.
export function VideoCard({
  src,
  poster,
  title,
  campaign,
  status,
  detail,
  youtubeUrl,
  children,
}: {
  src: string | null
  poster: string | null
  title: string
  campaign: string
  status: string
  detail?: string
  youtubeUrl?: string | null
  children?: React.ReactNode
}) {
  return (
    <article className="flex flex-col gap-3 rounded-md bg-card p-4">
      {src ? (
        <video controls playsInline preload="none" src={src} poster={poster ?? undefined} className="aspect-[9/16] w-full rounded-sm bg-black" />
      ) : (
        <div className="flex aspect-[9/16] w-full items-center justify-center rounded-sm bg-muted text-body-sm text-muted-foreground">Still being made</div>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-body-md-strong text-foreground">{title}</h2>
          <StatusBadge status={status} map={VIDEO_STATUS} className="shrink-0" />
        </div>
        <p className="text-body-sm text-muted-foreground">{campaign}</p>
        {detail && <p className="tabular text-caption text-muted-foreground">{detail}</p>}
        {youtubeUrl && (
          <a href={youtubeUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-body-sm text-primary-text underline underline-offset-4">
            Open on YouTube
            <ExternalLink aria-hidden className="size-4" strokeWidth={1.75} />
          </a>
        )}
      </div>
      {children}
    </article>
  )
}
