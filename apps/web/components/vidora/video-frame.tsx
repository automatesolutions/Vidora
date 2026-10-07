import { Play } from "lucide-react"
import { cn } from "@/lib/utils"

// ⊕ Video player frame: 12px radius, ink letterbox, 44px+ controls. The real player arrives in Phase 1.
export function VideoFrame({
  orientation = "vertical",
  duration,
  caption,
  className,
  children,
}: {
  orientation?: "vertical" | "horizontal"
  duration?: string
  caption?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <figure
      className={cn(
        "relative overflow-hidden rounded-md bg-ink text-on-primary",
        orientation === "vertical" ? "aspect-[9/16]" : "aspect-video",
        className
      )}
    >
      {children ?? <div aria-hidden className="absolute inset-0 bg-brand-gradient opacity-25" />}
      <button
        type="button"
        aria-label="Play video"
        className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink/70 text-on-primary backdrop-blur-sm transition-transform hover:scale-105 motion-reduce:hover:scale-100"
      >
        <Play className="size-7 translate-x-0.5 fill-current" strokeWidth={1.75} />
      </button>
      {caption && (
        <figcaption className="absolute inset-x-4 bottom-16 text-center text-display-xs text-balance [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]">
          {caption}
        </figcaption>
      )}
      {duration && (
        <span className="tabular absolute right-3 bottom-3 rounded-sm bg-ink/80 px-2 py-0.5 text-caption">{duration}</span>
      )}
    </figure>
  )
}
