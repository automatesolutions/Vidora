import Link from "next/link"
import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { AppNav, SignOutButton } from "@/components/vidora/app-nav"
import { Logo } from "@/components/vidora/logo"
import { requireSession } from "@/lib/server/session"

// Signed-in app chrome. The session is read inside Suspense (cacheComponents), so the frame renders instantly.
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:p-3">
        Skip to content
      </a>
      <header className="border-b border-border bg-background">
        <div className="safe-x mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 py-2 md:px-6">
          <Link href="/app" aria-label="AutoShorts Studio home" className="inline-flex min-h-11 items-center rounded-sm">
            <Logo width={104} priority />
          </Link>
          <Suspense fallback={<Skeleton className="h-11 w-64 bg-muted" />}>
            <HeaderSession />
          </Suspense>
        </div>
      </header>
      <main id="main" className="safe-x mx-auto w-full max-w-[1280px] flex-1 pt-8 pb-16 md:px-6">
        {children}
      </main>
    </div>
  )
}

async function HeaderSession() {
  await requireSession()
  return (
    <>
      <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
        <AppNav />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <SignOutButton />
      </div>
    </>
  )
}
