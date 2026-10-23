import { Check, Clapperboard, Film, Lightbulb, Send, Timer, type LucideIcon } from "lucide-react"
import { RUN_STATUS, StatusBadge } from "@/components/vidora/run-status"
import { cn } from "@/lib/utils"

// ⊕ Run progress card: where one run is in the pipeline, live (the page refreshes while it runs).
// The bar uses the logo gradient, one of the places it's allowed (vidora-design §2).

export type RunProgressInput = {
  status: string
  title: string | null
  hook: string | null
  scenesTotal: number
  scenesDone: number
  startedAt: Date | null
  estimateCredits: number | null
  now: Date
}

const STEPS: { label: string; icon: LucideIcon }[] = [
  { label: "Starting", icon: Timer },
  { label: "Planning", icon: Lightbulb },
  { label: "Scene clips", icon: Film },
  { label: "Editing", icon: Clapperboard },
  { label: "Posting", icon: Send },
]

/** Which step a run is on, and how far along the whole run is (0-100). */
export function runStep(r: Pick<RunProgressInput, "status" | "scenesTotal" | "scenesDone"> & { hasPlan: boolean }) {
  if (r.status === "planned") return { step: 0, pct: 4 }
  if (r.status === "generating" && !r.hasPlan) return { step: 1, pct: 12 }
  if (r.status === "generating") {
    const share = r.scenesTotal ? Math.min(1, r.scenesDone / r.scenesTotal) : 0
    return { step: 2, pct: Math.round(20 + share * 55) }
  }
  if (r.status === "assembling") return { step: 3, pct: 85 }
  if (r.status === "uploading") return { step: 4, pct: 95 }
  return { step: STEPS.length, pct: 100 }
}

/** "less than a minute ago", "3 min ago", "1 h 12 min ago". */
export function elapsed(from: Date, now: Date) {
  const min = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000))
  if (min < 1) return "less than a minute ago"
  if (min < 60) return `${min} min ago`
  return `${Math.floor(min / 60)} h ${min % 60} min ago`
}

export function RunProgressCard(props: RunProgressInput) {
  const { step, pct } = runStep({ ...props, hasPlan: props.scenesTotal > 0 })
  const detail = [
    step === 2 && props.scenesTotal ? `Scene clips ${props.scenesDone} of ${props.scenesTotal}` : null,
    props.startedAt ? `Started ${elapsed(props.startedAt, props.now)}` : "Starting in a few seconds",
    props.estimateCredits ? `about ${Math.round(props.estimateCredits)} credits` : null,
  ].filter(Boolean)

  return (
    <article className="flex flex-col gap-4 rounded-md bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-body-md-strong text-foreground">{props.title ?? "New video"}</h3>
          <p className="tabular text-caption text-muted-foreground">{detail.join(" · ")}</p>
        </div>
        <StatusBadge status={props.status === "planned" ? "starting" : props.status} map={RUN_STATUS} className="shrink-0" />
      </div>

      <div
        role="progressbar"
        aria-label={`${props.title ?? "New video"} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${STEPS[Math.min(step, STEPS.length - 1)]!.label}, ${pct} percent`}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>

      <ol className="grid grid-cols-5 gap-2">
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "active" : "pending"
          const Icon = state === "done" ? Check : s.icon
          return (
            <li key={s.label} aria-current={state === "active" ? "step" : undefined} className="flex flex-col items-center gap-1.5 text-center">
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full border",
                  state === "done" && "border-transparent bg-secondary text-secondary-foreground",
                  state === "active" && "border-primary bg-background text-primary-text motion-safe:animate-pulse",
                  state === "pending" && "border-border bg-background text-muted-foreground"
                )}
              >
                <Icon aria-hidden className="size-4" strokeWidth={1.75} />
              </span>
              <span className={cn("text-caption", state === "pending" ? "text-muted-foreground" : "text-foreground")}>
                {s.label}
                <span className="sr-only">{state === "done" ? ", done" : state === "active" ? ", in progress" : ", waiting"}</span>
              </span>
            </li>
          )
        })}
      </ol>

      {props.hook && <p className="text-body-sm text-muted-foreground">Hook: {props.hook}</p>}
    </article>
  )
}
