"use client"

import { STAGES as STAGE_IDS, type Stage } from "@vidora/core/credits"
import { RefreshCw } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { PipelineStepper } from "@/components/vidora/pipeline-stepper"
import { StatusPill } from "@/components/vidora/status-pill"
import { retryVideo } from "./actions"

type ProgressEvent = { id: string; event: string; toStatus: string | null; payload: Record<string, unknown>; createdAt: string }
type ProgressData = {
  job: {
    id: string
    status: string
    revision: number
    currentStage: Stage | null
    rerunFromStage: Stage | null
    progress: number
    errorMessage: string | null
    isFree: boolean
  }
  events: ProgressEvent[]
}

const DOING: Record<Stage, string> = {
  ideation: "Picking the angle",
  script: "Writing the script",
  voiceover: "Recording the voice",
  visuals: "Making the visuals",
  captions: "Adding captions",
  thumbnail: "Picking cover frames",
  render: "Putting it together",
}

const VISIBLE_MS = 2_000
const HIDDEN_MS = 10_000
const DONE = new Set(["pending_approval", "generation_failed", "canceled", "rejected", "approved", "scheduled", "published"])

/** Which step is active, from the newest stage event (stages before a rerun start count as done). */
function stepFrom(status: string, events: ProgressEvent[], rerunFrom: Stage | null): number {
  if (status === "pending_approval") return STAGE_IDS.length
  let idx = rerunFrom ? STAGE_IDS.indexOf(rerunFrom) : 0
  for (const e of events) {
    const stage = e.payload.stage as Stage | undefined
    if (!stage) continue
    const i = STAGE_IDS.indexOf(stage)
    if (e.event === "stage_completed") idx = Math.max(idx, i + 1)
    if (e.event === "stage_started") idx = Math.max(idx, i)
  }
  return Math.min(idx, STAGE_IDS.length - 1)
}

export function Progress({ initial }: { initial: ProgressData }) {
  const router = useRouter()
  const [data, setData] = useState(initial)
  const [failures, setFailures] = useState(0)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const etag = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { job, events } = data
  const failed = job.status === "generation_failed"
  const step = stepFrom(job.status, events, job.rerunFromStage)

  const poll = useCallback(async () => {
    const after = data.events.at(-1)?.id
    try {
      const res = await fetch(`/api/videos/${job.id}/progress${after ? `?after=${after}` : ""}`, {
        headers: etag.current ? { "if-none-match": etag.current } : {},
        cache: "no-store",
      })
      if (res.status === 304) return setFailures(0)
      if (!res.ok) throw new Error(String(res.status))
      etag.current = res.headers.get("etag")
      const next = (await res.json()) as ProgressData
      setFailures(0)
      setData((cur) => ({
        job: next.job,
        // A new revision (retry after changes) starts a fresh event list.
        events: next.job.revision !== cur.job.revision ? next.events : [...cur.events, ...next.events],
      }))
    } catch {
      setFailures((n) => n + 1)
    }
  }, [data.events, job.id])

  useEffect(() => {
    if (job.status === "pending_approval") {
      router.replace(`/app/videos/${job.id}/review`)
      return
    }
    if (DONE.has(job.status)) return
    const schedule = () => {
      const base = document.visibilityState === "visible" ? VISIBLE_MS : HIDDEN_MS
      // Back off while the connection is failing: 2 s, 4 s, 8 s … up to 30 s.
      timer.current = setTimeout(poll, Math.min(base * 2 ** failures, 30_000))
    }
    schedule()
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer.current) clearTimeout(timer.current)
        void poll()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [job.status, job.id, poll, failures, router])

  const activeStage = STAGE_IDS[Math.min(step, STAGE_IDS.length - 1)]!
  const statusLine = failed
    ? "This video didn't finish. We didn't use your credits."
    : job.status === "queued"
      ? "Starting your video"
      : job.status === "pending_approval"
        ? "Your video is ready. Opening the review page."
        : job.status === "canceled"
          ? "This video was canceled."
          : DOING[activeStage]

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={job.status as "queued"} />
          {job.revision > 1 && <span className="text-caption text-muted-foreground">Version {job.revision}</span>}
        </div>
        <h1 className="font-display text-display-md">{failed ? "This video didn't finish" : "Making your video"}</h1>
        <p className="text-body-md text-muted-foreground">
          {failed
            ? "Something went wrong on our side. Try again, and we'll start from the beginning."
            : "This takes about two minutes. It keeps going if you leave this page, and you'll find it under Videos."}
        </p>
      </div>

      <PipelineStepper current={step} failed={failed} />

      <p role="status" aria-live="polite" className="text-body-md-strong text-foreground">
        {statusLine}
      </p>

      {failed && (
        <div className="flex flex-col gap-4">
          {retryError && <InlineAlert title="We couldn't start it again">{retryError}</InlineAlert>}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setRetryError(null)
                  const r = await retryVideo(job.id)
                  if (!r.ok) return setRetryError(r.error)
                  etag.current = null
                  setData((d) => ({ job: { ...d.job, status: "queued", errorMessage: null }, events: [] }))
                })
              }
            >
              <RefreshCw aria-hidden />
              Try again
            </Button>
            <Button variant="tertiary" asChild>
              <Link href="/app/new">Make a different video</Link>
            </Button>
          </div>
        </div>
      )}

      {failures >= 3 && !DONE.has(job.status) && (
        <InlineAlert
          title="We lost the connection"
          action={
            <Button variant="tertiary" size="sm" onClick={() => void poll()}>
              Check now
            </Button>
          }
        >
          Your video keeps going. We&apos;ll update this page when we reconnect.
        </InlineAlert>
      )}
    </div>
  )
}
