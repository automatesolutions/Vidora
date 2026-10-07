import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// ⊕ Inline alert for errors and notices. Says what happened and what to do next.
const TONES: Record<"danger" | "success" | "info", { icon: LucideIcon; text: string; bar: string }> = {
  danger: { icon: CircleAlert, text: "text-danger", bar: "bg-danger" },
  success: { icon: CircleCheck, text: "text-success", bar: "bg-success" },
  info: { icon: Info, text: "text-foreground", bar: "bg-foreground" },
}

export function InlineAlert({
  tone = "danger",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof TONES
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const { icon: Icon, text, bar } = TONES[tone]
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("relative flex flex-wrap items-center gap-3 overflow-hidden rounded-md bg-card p-4 pl-5", className)}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", bar)} />
      <Icon aria-hidden className={cn("size-5 shrink-0 self-start", text)} strokeWidth={1.75} />
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <p className="text-body-sm-strong text-foreground">{title}</p>
        {children && <div className="text-body-sm text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  )
}
