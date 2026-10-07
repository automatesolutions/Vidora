import { TriangleAlert } from "lucide-react"
import { SiteValue } from "@/components/vidora/site-chrome"
import { HAS_PLACEHOLDERS } from "@/lib/site"

// Long-form legal page: readable line length, a table of contents, and anchored sections.
export type LegalSection = { id: string; title: string; body: React.ReactNode }

export function LegalPage({ title, intro, sections }: { title: string; intro: React.ReactNode; sections: LegalSection[] }) {
  return (
    <article className="safe-x mx-auto w-full max-w-[1280px] py-12 md:px-6 md:py-16">
      {HAS_PLACEHOLDERS && (
        <div role="note" className="mb-8 flex max-w-[70ch] gap-3 rounded-md bg-card p-4 text-body-sm">
          <TriangleAlert aria-hidden className="size-5 shrink-0 text-warning" strokeWidth={1.75} />
          <p>
            <span className="text-body-sm-strong">Draft.</span> Highlighted values are placeholders, and this text needs a
            lawyer&apos;s review before launch.
          </p>
        </div>
      )}
      <header className="flex max-w-[70ch] flex-col gap-4">
        <h1 className="font-display text-display-lg max-md:text-display-md">{title}</h1>
        <p className="text-body-sm text-muted-foreground">
          Effective <SiteValue field="effectiveDate" />
        </p>
        <div className="text-body-md text-muted-foreground">{intro}</div>
      </header>

      <div className="mt-12 grid gap-12 lg:grid-cols-[240px_minmax(0,70ch)]">
        <nav aria-label="On this page" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <p className="font-display text-eyebrow text-muted-foreground uppercase">On this page</p>
          <ol className="mt-3 flex flex-col">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex min-h-11 items-center rounded-sm px-2 text-body-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex min-w-0 flex-col gap-10">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-6">
              <h2 id={`${s.id}-title`} className="text-display-sub-sm">
                {i + 1}. {s.title}
              </h2>
              <div className="legal-prose mt-4 flex flex-col gap-4 text-body-md text-foreground">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </article>
  )
}

/** Inline external link styled for prose. */
export function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http")
  return (
    <a
      href={href}
      className="text-primary-text underline underline-offset-4 hover:no-underline"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  )
}
