import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// DESIGN.md buttons: 12px radius (never pills), padding md/xl (12/24px), ~48px tall.
// Rule: at most two filled buttons (primary, secondary) per view.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent whitespace-nowrap transition-[background-color,color,border-color,transform] duration-150 ease-out-soft select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
  {
    variants: {
      variant: {
        // button-primary: orange fill, warm-white label (19px/700 so it passes AA as large text)
        primary:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary),var(--color-ink)_12%)]",
        // button-secondary: ink fill (polarity-flips to canvas in dark mode)
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary),var(--primary)_14%)]",
        // button-tertiary: outline, 1px foreground border
        tertiary:
          "border-foreground bg-background text-foreground hover:bg-muted aria-expanded:bg-muted",
        // button-text: text-only, inside cards and nav
        text: "bg-transparent text-foreground hover:bg-muted aria-expanded:bg-muted",
        // Destructive confirm only (inside a confirm dialog), never a first-level action
        destructive: "bg-destructive text-on-primary dark:text-ink hover:bg-[color-mix(in_oklab,var(--destructive),var(--color-ink)_15%)]",
        link: "h-auto px-0 text-primary-text underline underline-offset-4 hover:no-underline",
      },
      size: {
        // 12 + 27 + 12 = ~51px with border: DESIGN.md button-md
        default: "min-h-12 px-6 py-3 text-button-md [&_svg:not([class*='size-'])]:size-5",
        // 44px minimum hit area (HIG); button-sm label
        sm: "min-h-11 px-4 py-2 text-button-sm [&_svg:not([class*='size-'])]:size-4",
        // Phone action bar: large thumb targets
        lg: "min-h-14 px-6 py-3 text-button-md [&_svg:not([class*='size-'])]:size-6",
        icon: "size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    compoundVariants: [
      // White on orange is 3.27:1, so small labels on orange fail AA. Small primary buttons use the darker orange.
      { variant: "primary", size: "sm", className: "bg-primary-text dark:text-ink" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
