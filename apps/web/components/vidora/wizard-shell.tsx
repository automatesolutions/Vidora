import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ⊕ Wizard shell: step count, one heading, one decision, Back (text) and one primary action.
// The heading takes focus on every step change, so screen readers announce the new step.

export function WizardShell({
  step,
  total,
  title,
  description,
  headingRef,
  onBack,
  primary,
  aside,
  children,
  className,
}: {
  step: number
  total: number
  title: string
  description?: string
  headingRef?: React.Ref<HTMLHeadingElement>
  onBack?: () => void
  primary: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("mx-auto flex w-full max-w-2xl flex-col gap-8", className)}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <p className="tabular text-caption text-muted-foreground">
            Step {step} of {total}
          </p>
          <div aria-hidden className="flex flex-1 gap-1">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={cn("h-1 flex-1 rounded-full", i < step ? "bg-foreground" : "bg-border")} />
            ))}
          </div>
        </div>
        <h1 ref={headingRef} tabIndex={-1} className="font-display text-display-md outline-none">
          {title}
        </h1>
        {description && <p className="max-w-[60ch] text-body-md text-muted-foreground">{description}</p>}
      </div>

      {children}

      <div className="safe-bottom sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background px-4 pt-4 sm:static sm:mx-0 sm:border-0 sm:px-0 sm:pt-0">
        {onBack ? (
          <Button variant="text" onClick={onBack}>
            <ArrowLeft aria-hidden />
            Back
          </Button>
        ) : (
          <span />
        )}
        {aside && <div className="text-body-sm text-muted-foreground max-sm:order-first max-sm:w-full">{aside}</div>}
        <div className="ml-auto">{primary}</div>
      </div>
    </div>
  )
}
