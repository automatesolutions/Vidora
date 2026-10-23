import { siFacebook, siTiktok, siYoutube } from "simple-icons"
import { cn } from "@/lib/utils"

// ⊕ Platform chip. Official marks in one color (currentColor), as both brands' guidelines allow.
export type Platform = "youtube" | "tiktok" | "facebook"

const PLATFORMS = {
  youtube: { name: "YouTube", path: siYoutube.path },
  tiktok: { name: "TikTok", path: siTiktok.path },
  facebook: { name: "Facebook", path: siFacebook.path },
} as const

export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-4 fill-current", className)}>
      <path d={PLATFORMS[platform].path} />
    </svg>
  )
}

export function PlatformChip({ platform, account, className }: { platform: Platform; account?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-body-sm text-foreground", className)}>
      <PlatformIcon platform={platform} />
      <span>{PLATFORMS[platform].name}</span>
      {account && <span className="text-muted-foreground">{account}</span>}
    </span>
  )
}
