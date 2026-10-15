"use client"

import { Archive, Pause, Play, SkipForward, Zap } from "lucide-react"
import { useTransition } from "react"
import { Button } from "@/components/ui/button"
import { archiveAction, pauseAction, resumeAction, runNowAction, skipNextAction } from "../actions"

// Campaign controls. "Run now" is the one filled button; the rest are outlines so the page keeps
// at most two filled buttons.
export function CampaignControls({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition()
  const act = (fn: (id: string) => Promise<void>) => () => start(() => fn(id))
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={act(runNowAction)} disabled={pending}>
        <Zap aria-hidden />
        Run now
      </Button>
      {status === "active" ? (
        <Button variant="tertiary" onClick={act(pauseAction)} disabled={pending}>
          <Pause aria-hidden />
          Pause
        </Button>
      ) : (
        <Button variant="tertiary" onClick={act(resumeAction)} disabled={pending || status === "archived"}>
          <Play aria-hidden />
          Resume
        </Button>
      )}
      <Button variant="tertiary" onClick={act(skipNextAction)} disabled={pending || status !== "active"}>
        <SkipForward aria-hidden />
        Skip next
      </Button>
      <Button
        variant="text"
        disabled={pending}
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
