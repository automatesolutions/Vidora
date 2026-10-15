import { Ban, CalendarClock, CircleAlert, CircleCheck, CircleDot, CirclePause, Clock, Loader, SkipForward, Upload, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ⊕ Status pills for runs, videos, and campaigns: icon + label + color, never color alone.

type Tone = "default" | "success" | "warning" | "danger" | "brand"
type Status = { label: string; icon: LucideIcon; tone: Tone; spin?: boolean }

export const RUN_STATUS: Record<string, Status> = {
  planned: { label: "Booked", icon: Clock, tone: "default" },
  generating: { label: "Generating", icon: Loader, tone: "brand", spin: true },
  assembling: { label: "Editing", icon: Loader, tone: "brand", spin: true },
  awaiting_approval: { label: "Needs approval", icon: CircleDot, tone: "warning" },
  uploading: { label: "Uploading", icon: Upload, tone: "brand" },
  scheduled: { label: "Scheduled", icon: CalendarClock, tone: "default" },
  published: { label: "Published", icon: CircleCheck, tone: "success" },
  failed: { label: "Failed", icon: CircleAlert, tone: "danger" },
  skipped: { label: "Skipped", icon: SkipForward, tone: "default" },
  canceled: { label: "Canceled", icon: Ban, tone: "default" },
}

export const VIDEO_STATUS: Record<string, Status> = {
  generating: { label: "Generating", icon: Loader, tone: "brand", spin: true },
  ready: { label: "Ready", icon: CircleCheck, tone: "success" },
  scheduled: { label: "Scheduled", icon: CalendarClock, tone: "default" },
  published: { label: "Published", icon: CircleCheck, tone: "success" },
  failed: { label: "Failed", icon: CircleAlert, tone: "danger" },
}

export const CAMPAIGN_STATUS: Record<string, Status> = {
  draft: { label: "Draft", icon: Clock, tone: "default" },
  active: { label: "Active", icon: CircleCheck, tone: "success" },
  paused: { label: "Paused", icon: CirclePause, tone: "warning" },
  archived: { label: "Archived", icon: Ban, tone: "default" },
}

export function StatusBadge({ status, map, className }: { status: string; map: Record<string, Status>; className?: string }) {
  const s = map[status] ?? { label: status, icon: Clock, tone: "default" as const }
  const Icon = s.icon
  return (
    <Badge variant={s.tone} className={cn("gap-1.5", className)}>
      <Icon aria-hidden className={cn("size-4", s.spin && "animate-spin motion-reduce:animate-none")} strokeWidth={1.75} />
      {s.label}
    </Badge>
  )
}

export const MODE_LABEL: Record<string, string> = { original: "Original", product: "Product", ugc: "UGC-style", clipping: "Clipping" }

export const PAUSE_REASON: Record<string, string> = {
  user: "You paused it.",
  monthly_cap: "It reached its monthly credit limit.",
  run_cap: "A video would cost more than the limit per video.",
  low_balance: "Your Higgsfield credits are low.",
  bad_credentials: "Higgsfield isn't connected.",
  youtube_auth: "The YouTube login expired.",
  repeated_failures: "Several videos in a row didn't finish.",
}
