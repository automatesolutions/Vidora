import Image from "next/image"
import { cn } from "@/lib/utils"

// Vidora logo. Files come from `pnpm brand`; never recolor them (see vidora-design skill §2).
// The dark-mode file swaps only the wordmark to #FFFEFB.
const RATIO = 818 / 231

export function Logo({ width = 120, className, priority }: { width?: number; className?: string; priority?: boolean }) {
  const height = Math.round(width / RATIO)
  return (
    <span className={cn("inline-flex shrink-0", className)} style={{ width, height }}>
      <Image src="/brand/vidora-logo.svg" alt="Vidora" width={width} height={height} priority={priority} unoptimized className="dark:hidden" />
      <Image src="/brand/vidora-logo-dark.svg" alt="Vidora" width={width} height={height} priority={priority} unoptimized className="hidden dark:block" />
    </span>
  )
}

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return <Image src="/brand/vidora-mark.svg" alt="Vidora" width={size} height={Math.round(size * (227 / 254))} unoptimized className={className} />
}
