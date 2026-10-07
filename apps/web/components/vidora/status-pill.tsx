import {
  Ban,
  CalendarClock,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Clock,
  Loader,
  PencilLine,
  X,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ⊕ Status pill: DESIGN.md badge-pill + icon + label. Color is never the only signal.
export type VideoStatus =
  | "queued"
  | "generating"
  | "pending_approval"
  | "changes_requested"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "rejected"
  | "generation_failed"
  | "publish_failed"
  | "canceled"

type Tone = "default" | "success" | "warning" | "danger" | "brand"

export const STATUS: Record<VideoStatus, { label: string; icon: LucideIcon; tone: Tone; spin?: boolean }> = {
  queued: { label: "Queued", icon: Clock, tone: "default" },
  generating: { label: "Generating", icon: Loader, tone: "brand", spin: true },
  pending_approval: { label: "Needs review", icon: CircleDot, tone: "warning" },
  changes_requested: { label: "Changes requested", icon: PencilLine, tone: "warning" },
  approved: { label: "Approved", icon: Check, tone: "success" },
  scheduled: { label: "Scheduled", icon: CalendarClock, tone: "default" },
  publishing: { label: "Posting", icon: Loader, tone: "brand", spin: true },
  published: { label: "Posted", icon: CircleCheck, tone: "success" },
  rejected: { label: "Rejected", icon: X, tone: "default" },
  generation_failed: { label: "Didn't finish", icon: CircleAlert, tone: "danger" },
  publish_failed: { label: "Post failed", icon: CircleAlert, tone: "danger" },
  canceled: { label: "Canceled", icon: Ban, tone: "default" },
}

export function StatusPill({ status, className }: { status: VideoStatus; className?: string }) {
  const { label, icon: Icon, tone, spin } = STATUS[status]
  return (
    <Badge variant={tone} className={className}>
      <Icon aria-hidden className={cn(spin && "animate-spin [animation-duration:2s] motion-reduce:animate-none")} />
      {label}
    </Badge>
  )
}
