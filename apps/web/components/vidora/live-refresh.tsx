"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

// ⊕ Live refresh: while something on the page is still changing (a run generating, a Run now
// waiting to start), re-render the server data every few seconds. Stops when nothing is active and
// while the tab is hidden, so an idle page makes no requests.
export function LiveRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh()
    }
    const timer = setInterval(tick, intervalMs)
    // Coming back to the tab shows the latest state right away.
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [active, intervalMs, router])
  return null
}
