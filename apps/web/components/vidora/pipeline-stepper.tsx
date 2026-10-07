import {
  Captions,
  Check,
  CircleAlert,
  Clapperboard,
  FileText,
  Film,
  Image as ImageIcon,
  Lightbulb,
  Mic,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ⊕ Pipeline stepper. The progress fill is one of the few places the logo gradient is allowed.
export const STAGES: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "ideation", label: "Idea", icon: Lightbulb },
  { id: "script", label: "Script", icon: FileText },
  { id: "voiceover", label: "Voice", icon: Mic },
  { id: "visuals", label: "Visuals", icon: Film },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "thumbnail", label: "Thumbnail", icon: ImageIcon },
  { id: "render", label: "Final video", icon: Clapperboard },
]

const STATE_TEXT = { done: ", done", active: ", in progress", failed: ", failed", pending: ", waiting" }

export function PipelineStepper({ current, failed, className }: { current: number; failed?: boolean; className?: string }) {
  const pct = Math.round((Math.min(current, STAGES.length) / STAGES.length) * 100)
  const done = current >= STAGES.length
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        role="progressbar"
        aria-label="Video progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", failed ? "bg-danger" : "bg-brand-gradient")}
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>
      <ol className="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-7">
        {STAGES.map((stage, i) => {
          const state: keyof typeof STATE_TEXT =
            i < current ? "done" : i === current && !done ? (failed ? "failed" : "active") : "pending"
          const Icon = state === "done" ? Check : state === "failed" ? CircleAlert : stage.icon
          return (
            <li
              key={stage.id}
              aria-current={state === "active" ? "step" : undefined}
              className="flex flex-col items-center gap-1.5 text-center"
            >
              <span
                className={cn(
                  "flex size-10 items-center justify-center rounded-full border",
                  state === "done" && "border-transparent bg-secondary text-secondary-foreground",
                  state === "active" && "border-primary bg-background text-primary-text",
                  state === "failed" && "border-danger bg-background text-danger",
                  state === "pending" && "border-border bg-background text-muted-foreground"
                )}
              >
                <Icon aria-hidden className="size-5" strokeWidth={1.75} />
              </span>
              <span className={cn("text-caption", state === "pending" ? "text-muted-foreground" : "text-foreground")}>
                {stage.label}
                <span className="sr-only">{STATE_TEXT[state]}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
