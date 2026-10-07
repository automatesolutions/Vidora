"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

const noop = () => () => {}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  // The stored theme is only known in the browser; render no selection on the server.
  const mounted = useSyncExternalStore(noop, () => true, () => false)

  return (
    <div role="group" aria-label="Color theme" className={cn("inline-flex rounded-md bg-muted p-1", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mounted && theme === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm px-3 text-body-sm transition-colors",
              active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon aria-hidden className="size-5" strokeWidth={1.75} />
            <span aria-hidden className="max-sm:hidden">
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
