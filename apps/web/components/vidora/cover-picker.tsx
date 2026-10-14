import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

// ⊕ Cover frame picker: frame candidates from the pipeline as a radio group (arrow keys move between them).

export function CoverPicker({
  frames,
  value,
  onChange,
  disabled,
}: {
  frames: { ordinal: number; url: string; atSec: number }[]
  value: number
  onChange: (ordinal: number) => void
  disabled?: boolean
}) {
  if (frames.length === 0) return null
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-body-sm-strong text-foreground">Cover frame</legend>
      <div className="grid grid-cols-6 gap-2">
        {frames.map((f, i) => {
          const checked = f.ordinal === value
          return (
            <label
              key={f.ordinal}
              className={cn(
                "relative aspect-[9/16] cursor-pointer overflow-hidden rounded-sm border-2 transition-colors",
                checked ? "border-foreground" : "border-transparent hover:border-border",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                disabled && "cursor-default opacity-60"
              )}
            >
              <input type="radio" name="cover" value={f.ordinal} checked={checked} onChange={() => onChange(f.ordinal)} className="sr-only" />
              <span className="sr-only">
                Frame {i + 1} of {frames.length}, at {f.atSec} seconds
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
              <img src={f.url} alt="" className="size-full object-cover" loading="lazy" />
              {checked && (
                <span aria-hidden className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <Check className="size-3.5" strokeWidth={2.5} />
                </span>
              )}
            </label>
          )
        })}
      </div>
      <p className="text-caption text-muted-foreground">YouTube may show a different frame in the Shorts feed.</p>
    </fieldset>
  )
}
