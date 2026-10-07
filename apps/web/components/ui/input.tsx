import * as React from "react"
import { cn } from "@/lib/utils"

// DESIGN.md text-input: canvas fill, 1px ink border, 6px radius, body-md, padding md/lg (12/16px).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "min-h-12 w-full min-w-0 rounded-sm border border-input bg-background px-4 py-3 text-body-md text-foreground transition-colors outline-none file:inline-flex file:border-0 file:bg-transparent file:text-body-sm-strong placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
