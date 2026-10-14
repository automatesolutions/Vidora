import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/vidora/logo"
import { isPlaceholder, SITE } from "@/lib/site"

// Marketing header and footer. DESIGN.md nav-bar (canvas) and footer (ink, canvas-soft text).

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="safe-x mx-auto flex w-full max-w-[1280px] items-center justify-between py-3 md:px-6">
        <Link href="/" aria-label="Vidora home" className="inline-flex min-h-11 items-center rounded-sm">
          <Logo width={120} priority />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          <Button asChild variant="text" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm" className="max-sm:hidden">
            <Link href="/sign-up">Create account</Link>
          </Button>
        </nav>
      </div>
    </header>
  )
}

/** Shows a site value, and marks it clearly while it is still a placeholder. */
export function SiteValue({ field }: { field: Exclude<keyof typeof SITE, "copyrightYear"> }) {
  const value = SITE[field]
  if (!isPlaceholder(value)) return <>{value}</>
  return <mark className="rounded-sm bg-warning/15 px-1 text-warning">{value}</mark>
}

export function SiteFooter() {
  const email = SITE.supportEmail
  return (
    <footer className="bg-ink text-canvas-soft dark:border-t dark:border-ink-mid">
      <div className="safe-x mx-auto flex w-full max-w-[1280px] flex-col gap-8 py-12 md:flex-row md:items-start md:justify-between md:px-6">
        <div className="flex max-w-[44ch] flex-col gap-3">
          <Image src="/brand/vidora-logo-dark.svg" alt="Vidora" width={112} height={32} unoptimized />
          <p className="text-body-sm text-mute">Videos for your YouTube and TikTok channels. Nothing posts until you approve it.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-col gap-1 text-body-sm">
            <li>
              <Link href="/legal/privacy" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                Privacy policy
              </Link>
            </li>
            <li>
              <Link href="/legal/terms" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                Terms of service
              </Link>
            </li>
            <li>
              {isPlaceholder(email) ? (
                <span className="inline-flex min-h-11 items-center text-mute">Support email coming soon</span>
              ) : (
                <a href={`mailto:${email}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                  {email}
                </a>
              )}
            </li>
          </ul>
        </nav>
      </div>
      <div className="safe-x mx-auto w-full max-w-[1280px] border-t border-ink-mid py-6 text-caption text-mute md:px-6">
        © {SITE.copyrightYear} {isPlaceholder(SITE.legalName) ? SITE.name : SITE.legalName}. YouTube is a trademark of Google LLC.
        TikTok is a trademark of ByteDance Ltd. Vidora is not affiliated with either.
      </div>
    </footer>
  )
}
