"use client"

import { Check, PencilLine, X } from "lucide-react"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ⊕ Approval action bar. Two filled buttons max: Approve (primary) and Request changes (secondary).
// Desktop shortcuts: A approve, R reject, C request changes. They never fire while typing.
export type Decision = "approve" | "reject" | "changes"

const KEYS: Record<string, Decision> = { a: "approve", r: "reject", c: "changes" }

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
}

export function ApprovalBar({
  scheduledLabel,
  onDecision,
  layout = "desktop",
  shortcuts = false,
  disabled,
  className,
}: {
  scheduledLabel: string
  onDecision: (decision: Decision) => void
  layout?: "desktop" | "mobile"
  shortcuts?: boolean
  disabled?: boolean
  className?: string
}) {
  useEffect(() => {
    if (!shortcuts || disabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return
      const decision = KEYS[e.key.toLowerCase()]
      if (!decision) return
      e.preventDefault()
      onDecision(decision)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [shortcuts, disabled, onDecision])

  if (layout === "mobile") {
    // Thumb zone: three 56px targets, Approve on the right where the thumb rests.
    return (
      <div role="group" aria-label="Review decision" className={cn("safe-bottom grid grid-cols-3 gap-2 bg-background pt-3", className)}>
        <Button variant="tertiary" size="lg" disabled={disabled} onClick={() => onDecision("reject")} className="flex-col gap-0.5 px-2 text-button-sm">
          <X aria-hidden />
          Reject
        </Button>
        <Button variant="secondary" size="lg" disabled={disabled} onClick={() => onDecision("changes")} className="flex-col gap-0.5 px-2 text-button-sm">
          <PencilLine aria-hidden />
          Changes
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={disabled}
          onClick={() => onDecision("approve")}
          aria-label={`Approve for ${scheduledLabel}`}
          className="flex-col gap-0.5 px-2"
        >
          <Check aria-hidden />
          Approve
        </Button>
      </div>
    )
  }

  const kbd = (key: string) =>
    shortcuts ? (
      <kbd aria-hidden className="ml-1 hidden rounded-sm border border-current/30 px-1.5 text-caption font-normal opacity-80 lg:inline">
        {key}
      </kbd>
    ) : null

  return (
    <div role="group" aria-label="Review decision" className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button variant="tertiary" disabled={disabled} onClick={() => onDecision("reject")} aria-keyshortcuts={shortcuts ? "R" : undefined}>
        <X aria-hidden />
        Reject
        {kbd("R")}
      </Button>
      <Button variant="secondary" disabled={disabled} onClick={() => onDecision("changes")} aria-keyshortcuts={shortcuts ? "C" : undefined}>
        <PencilLine aria-hidden />
        Request changes
        {kbd("C")}
      </Button>
      <Button variant="primary" disabled={disabled} onClick={() => onDecision("approve")} aria-keyshortcuts={shortcuts ? "A" : undefined} className="grow">
        <Check aria-hidden />
        Approve for {scheduledLabel}
        {kbd("A")}
      </Button>
    </div>
  )
}
