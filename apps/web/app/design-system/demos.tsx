"use client"

import { Check, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ApprovalBar, type Decision } from "@/components/vidora/approval-bar"
import { contrastRatio, parseColor } from "@/lib/contrast"
import { cn } from "@/lib/utils"
import pairsFile from "@/lib/contrast-pairs.json"

const CHANGE_TARGETS = ["Script", "Voice", "Visuals", "Captions", "Thumbnail"] as const
const SLOT = "Tue 6:00 PM"

export function ApprovalDemo({ layout }: { layout: "desktop" | "mobile" }) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [targets, setTargets] = useState<string[]>([])
  const [note, setNote] = useState("")

  const onDecision = useCallback((d: Decision) => {
    if (d === "approve") {
      // Actionable toast: no auto-dismiss timer (HIG), Undo stays until dismissed.
      toast.success(`Approved. Posting ${SLOT}.`, {
        duration: Infinity,
        closeButton: true,
        action: { label: "Undo", onClick: () => toast("Approval undone. The video is back in your queue.") },
      })
    }
    if (d === "reject") setRejectOpen(true)
    if (d === "changes") setChangesOpen(true)
  }, [])

  const toggle = (t: string) => setTargets((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))

  return (
    <>
      <ApprovalBar
        layout={layout}
        scheduledLabel={SLOT}
        onDecision={onDecision}
        shortcuts={layout === "desktop" && !rejectOpen && !changesOpen}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reject this video?</DialogTitle>
            <DialogDescription>We won&apos;t post it, and it won&apos;t use more credits.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 sm:justify-end">
            <Button variant="tertiary" onClick={() => setRejectOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setRejectOpen(false)
                toast("Video rejected.", { duration: Infinity, closeButton: true, action: { label: "Undo", onClick: () => {} } })
              }}
            >
              Reject video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={changesOpen} onOpenChange={setChangesOpen}>
        <SheetContent side="bottom" className="mx-auto w-full max-w-2xl">
          <SheetHeader>
            <SheetTitle>What should change?</SheetTitle>
            <SheetDescription>Pick the parts to redo. We&apos;ll keep everything else.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-6">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-body-sm-strong">Parts to redo</legend>
              <div className="flex flex-wrap gap-2">
                {CHANGE_TARGETS.map((t) => {
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
                      {t}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <div className="flex flex-col gap-2">
              <Label htmlFor="change-note" className="text-body-sm-strong">
                What should we do differently?
              </Label>
              <Textarea
                id="change-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Example: Make the hook shorter and use a calmer voice."
              />
            </div>
          </div>
          <SheetFooter className="sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body-sm text-muted-foreground">Free. 1 free change left.</p>
            <Button
              disabled={targets.length === 0}
              onClick={() => {
                setChangesOpen(false)
                toast(`Got it. We're redoing: ${targets.join(", ")}.`)
              }}
            >
              Send changes
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

// Reads the live CSS custom properties, so the table always matches the current theme.
const FALLBACK: Record<string, string> = { "--color-ink": "#201515", "--color-on-primary": "#fffefb" }

type Row = { use: string; fg: string; bg: string; ratio: number; min: number; fgVal: string; bgVal: string }

export function LiveContrastTable() {
  const [rows, setRows] = useState<Row[]>([])
  const [mode, setMode] = useState<"light" | "dark">("light")

  useEffect(() => {
    const compute = () => {
      const html = document.documentElement
      const current = html.classList.contains("dark") ? "dark" : "light"
      const style = getComputedStyle(html)
      const read = (token: string) => style.getPropertyValue(token).trim() || FALLBACK[token] || ""
      setMode(current)
      setRows(
        pairsFile.pairs
          .filter((p) => !("mode" in p) || p.mode === current)
          .map((p) => {
            const fgVal = read(p.fg)
            const bgVal = read(p.bg)
            const a = parseColor(fgVal)
            const b = parseColor(bgVal)
            return { use: p.use, fg: p.fg, bg: p.bg, min: p.min, fgVal, bgVal, ratio: a && b ? contrastRatio(a, b) : 0 }
          })
      )
    }
    compute()
    const obs = new MutationObserver(compute)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])

  return (
    <div role="region" aria-label="Contrast checks" tabIndex={0} className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[640px] text-left text-body-sm">
        <caption className="bg-card px-4 py-3 text-left text-caption text-muted-foreground">
          Live from the CSS in {mode} mode. The same pairs run in CI with <code>pnpm contrast</code>.
        </caption>
        <thead className="bg-card">
          <tr>
            {["Sample", "Use", "Tokens", "Ratio", "Needs", "Result"].map((h) => (
              <th key={h} scope="col" className="px-4 py-3 text-caption font-normal text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pass = r.ratio >= r.min
            return (
              <tr key={`${r.fg}-${r.bg}-${r.use}`} className="border-t border-border">
                <td className="px-4 py-3">
                  <Sample row={r} />
                </td>
                <td className="px-4 py-3">{r.use}</td>
                <td className="px-4 py-3 font-mono text-caption text-muted-foreground">
                  {r.fg} on {r.bg}
                </td>
                <td className="tabular px-4 py-3">{r.ratio.toFixed(2)}</td>
                <td className="tabular px-4 py-3">{r.min}:1</td>
                <td className="px-4 py-3">
                  <span className={cn("inline-flex items-center gap-1", pass ? "text-success" : "text-danger")}>
                    {pass ? <Check aria-hidden className="size-4" /> : <X aria-hidden className="size-4" />}
                    {pass ? "Pass" : "Fail"}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Samples render the way the pair is allowed to be used, so axe checks them correctly:
// 4.5:1 pairs as body text, 3:1 text pairs as large text (24px), and non-text pairs as a border.
function Sample({ row }: { row: Row }) {
  if (/non-text/.test(row.use)) {
    return (
      <span aria-hidden className="inline-flex size-10 rounded-sm border-2" style={{ borderColor: row.fgVal, background: row.bgVal }} />
    )
  }
  return (
    <span
      className={cn("inline-flex min-w-16 justify-center rounded-sm px-2 py-1", row.min < 4.5 ? "text-[24px] leading-8" : "text-body-sm")}
      style={{ color: row.fgVal, background: row.bgVal }}
    >
      Aa
    </span>
  )
}

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="tertiary" size="sm" onClick={() => toast("Saved. Your strategy runs next at 9:00 AM.")}>
        Show info toast
      </Button>
      <Button
        variant="tertiary"
        size="sm"
        onClick={() =>
          toast.error("We couldn't post to TikTok. Your TikTok login expired.", {
            duration: Infinity,
            closeButton: true,
            action: { label: "Reconnect TikTok", onClick: () => {} },
          })
        }
      >
        Show error toast
      </Button>
    </div>
  )
}
