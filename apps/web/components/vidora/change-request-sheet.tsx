"use client"

import { CHANGE_TARGETS, type ChangeTarget } from "@vidora/core/credits"
import { Check, LoaderCircle } from "lucide-react"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { cn } from "@/lib/utils"

// ⊕ "What should change?" sheet (copy from the design skill §7). Sends the picked parts and a note;
// the rerun starts at the earliest picked part.

const LABELS: Record<ChangeTarget, string> = { script: "Script", voice: "Voice", visuals: "Visuals", captions: "Captions", thumbnail: "Thumbnail" }

export function ChangeRequestSheet({
  open,
  onOpenChange,
  costLabel,
  pending,
  error,
  onSend,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  costLabel: (targets: ChangeTarget[]) => string
  pending: boolean
  error: string | null
  onSend: (targets: ChangeTarget[], text: string) => void
}) {
  const noteId = useId()
  const [targets, setTargets] = useState<ChangeTarget[]>([])
  const [note, setNote] = useState("")
  const toggle = (t: ChangeTarget) => setTargets((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto w-full max-w-2xl">
        <SheetHeader>
          <SheetTitle>What should change?</SheetTitle>
          <SheetDescription>Pick the parts to redo. We&apos;ll keep everything else.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-6">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-body-sm-strong">Parts to redo</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CHANGE_TARGETS) as ChangeTarget[]).map((t) => {
                const on = targets.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(t)}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-body-sm transition-colors",
                      on ? "border-foreground bg-secondary text-secondary-foreground" : "border-border bg-background text-foreground hover:bg-muted"
                    )}
                  >
                    {on && <Check aria-hidden className="size-4" strokeWidth={1.75} />}
                    {LABELS[t]}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor={noteId} className="text-body-sm-strong">
              What should we do differently?
            </label>
            <Textarea
              id={noteId}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Example: Make the hook shorter and use a calmer voice."
            />
          </div>
          {error && <InlineAlert title="We couldn't send your changes">{error}</InlineAlert>}
        </div>
        <SheetFooter className="sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular text-body-sm text-muted-foreground">{costLabel(targets)}</p>
          <Button disabled={targets.length === 0 || pending} onClick={() => onSend(targets, note)}>
            {pending && <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />}
            Send changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
