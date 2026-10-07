import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// DESIGN.md ex-empty-state-card: canvas-soft, 12px radius, 48px padding, body-md caption.
// Rule: say why it's empty and what to do next.
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  body: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 rounded-md bg-card p-12 text-center max-sm:p-6", className)}>
      <span className="flex size-16 items-center justify-center rounded-full bg-background text-primary-text">
        <Icon aria-hidden className="size-7" strokeWidth={1.75} />
      </span>
      <div className="flex max-w-[44ch] flex-col gap-1">
        <p className="text-display-xs text-foreground">{title}</p>
        <p className="text-body-md text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  )
}
