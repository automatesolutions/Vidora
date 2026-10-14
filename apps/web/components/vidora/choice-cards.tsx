import { Check, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// ⊕ Choice cards: a radio group drawn as cards (one decision per screen in the create-video wizard).
// Native radios underneath, so arrow keys, labels, and screen readers work without extra code.

export type ChoiceOption<T extends string> = {
  value: T
  label: string
  description?: string
  icon?: LucideIcon
  meta?: string
}

export function ChoiceCards<T extends string>({
  name,
  legend,
  hideLegend,
  options,
  value,
  onChange,
  columns = 2,
  size = "md",
  className,
}: {
  name: string
  legend: string
  hideLegend?: boolean
  options: ChoiceOption<T>[]
  value: T | null
  onChange: (value: T) => void
  columns?: 1 | 2 | 3
  size?: "md" | "sm"
  className?: string
}) {
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-3", className)}>
      <legend className={cn("mb-3 text-body-sm-strong text-foreground", hideLegend && "sr-only")}>{legend}</legend>
      <div
        className={cn(
          "grid gap-3",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "grid-cols-2 sm:grid-cols-3"
        )}
      >
        {options.map((o) => {
          const Icon = o.icon
          const checked = value === o.value
          return (
            <label
              key={o.value}
              className={cn(
                "relative flex cursor-pointer items-start gap-3 rounded-md border bg-background transition-colors duration-150",
                size === "md" ? "min-h-16 p-4" : "min-h-12 px-4 py-3",
                checked ? "border-foreground bg-card" : "border-border hover:border-foreground/60",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {Icon && (
                <span
                  aria-hidden
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    checked ? "bg-secondary text-secondary-foreground" : "bg-muted text-foreground"
                  )}
                >
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-7">
                <span className="text-body-sm-strong text-foreground">{o.label}</span>
                {o.description && <span className="text-body-sm text-muted-foreground">{o.description}</span>}
                {o.meta && <span className="tabular text-caption text-muted-foreground">{o.meta}</span>}
              </span>
              <span
                aria-hidden
                className={cn(
                  "absolute top-4 right-4 flex size-5 items-center justify-center rounded-full border",
                  checked ? "border-foreground bg-secondary text-secondary-foreground" : "border-border"
                )}
              >
                {checked && <Check className="size-3.5" strokeWidth={2.5} />}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
