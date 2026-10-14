import { CircleUserRound } from "lucide-react"
import { cn } from "@/lib/utils"

// ⊕ Shorts frame: the real 9:16 player inside a YouTube Shorts-style frame, so the creator sees roughly
// what viewers will see. Native controls (keyboard and screen-reader friendly). The channel row sits at
// the top so it never covers the controls.

export function ShortsFrame({
  src,
  poster,
  title,
  channel,
  className,
}: {
  src: string | null
  poster?: string | null
  title: string
  channel: { name: string; avatarUrl: string | null } | null
  className?: string
}) {
  return (
    <figure className={cn("relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-md bg-ink text-on-primary", className)}>
      {src ? (
        <video
          src={src}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          aria-label={`Video: ${title}`}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-body-sm text-mute">The video file isn&apos;t ready yet.</div>
      )}
      <figcaption className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-ink/80 to-transparent p-3 pb-8">
        {channel?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- channel avatar from Google
          <img src={channel.avatarUrl} alt="" className="size-8 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <CircleUserRound aria-hidden className="size-8" strokeWidth={1.5} />
        )}
        <span className="truncate text-body-sm-strong">{channel?.name ?? "Your channel"}</span>
        <span className="ml-auto rounded-sm bg-on-primary/15 px-1.5 text-caption">Shorts</span>
      </figcaption>
    </figure>
  )
}
