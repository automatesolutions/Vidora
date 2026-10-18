"use client"

import { Film, Inbox, LayoutDashboard, LogOut, Megaphone, PlugZap } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useTransition } from "react"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

// App navigation. Links are text-style, so the page's own buttons stay the only filled ones.
const LINKS = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/app/library", label: "Library", icon: Film },
  { href: "/app/approvals", label: "Approvals", icon: Inbox },
  { href: "/app/connections", label: "Connections", icon: PlugZap },
] as const

export function AppNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="-mx-1 flex min-w-0 gap-1 overflow-x-auto">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === "/app" ? pathname === "/app" : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-body-sm transition-colors",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon aria-hidden className="size-5" strokeWidth={1.75} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

export function SignOutButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="text"
      size="icon"
      aria-label="Sign out"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await authClient.signOut()
          router.push("/sign-in")
          router.refresh()
        })
      }
    >
      <LogOut aria-hidden />
    </Button>
  )
}
