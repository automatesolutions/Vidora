"use client"

import { Archive, Loader, Pause, Play, SkipForward, Zap } from "lucide-react"
import { useTransition } from "react"
import { Button } from "@/components/ui/button"
import { archiveAction, pauseAction, resumeAction, runNowAction, skipNextAction } from "../actions"

// Campaign controls. "Run now" is the one filled button; the rest are outlines so the page keeps
// at most two filled buttons.
export function CampaignControls({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition()
  const [starting, startRun] = useTransition()
  const act = (fn: (id: string) => Promise<void>) => () => start(() => fn(id))
  const busy = pending || starting
  return (
    <div className="flex flex-wrap gap-3">
      {/* The new run appears under "In progress" as soon as the action returns; the page then updates live. */}
      <Button onClick={() => startRun(() => runNowAction(id))} disabled={busy} aria-live="polite">
        {starting ? <Loader aria-hidden className="motion-safe:animate-spin" /> : <Zap aria-hidden />}
        {starting ? "Starting" : "Run now"}
      </Button>
      {status === "active" ? (
        <Button variant="tertiary" onClick={act(pauseAction)} disabled={busy}>
          <Pause aria-hidden />
          Pause
        </Button>
      ) : (
        <Button variant="tertiary" onClick={act(resumeAction)} disabled={busy || status === "archived"}>
          <Play aria-hidden />
          Resume
        </Button>
      )}
      <Button variant="tertiary" onClick={act(skipNextAction)} disabled={busy || status !== "active"}>
        <SkipForward aria-hidden />
        Skip next
      </Button>
      <Button
        variant="text"
        disabled={busy}
        onClick={() => {
          if (window.confirm("Archive this campaign? Booked videos are canceled. Finished videos stay in your library.")) start(() => archiveAction(id))
        }}
      >
        <Archive aria-hidden />
        Archive
      </Button>
    </div>
  )
}
