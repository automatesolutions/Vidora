import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// DESIGN.md badge-pill: canvas-soft fill, ink text, body-sm, padding xs/md (4/12px), pill radius.
// ⊕ Status tones color the text and dot only. Always pair a status badge with an icon and a label.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-transparent px-3 py-1 text-body-sm whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-4 [&>svg]:stroke-[1.75]",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground",
        outline: "border-border bg-background text-foreground",
        success: "bg-muted text-success",
        warning: "bg-muted text-warning",
        danger: "bg-muted text-danger",
        brand: "bg-muted text-primary-text",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
