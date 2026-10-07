import { CalendarClock, CircleCheck, Link2, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

// Placeholder home until the Phase 1 landing page. Google's OAuth review needs the homepage to say what
// the app does and how it uses account access, with a link to the privacy policy. This page does both.
const STEPS = [
  { icon: Link2, title: "Connect your channels", body: "Sign in with YouTube or TikTok. We ask only for permission to post the videos you approve." },
  { icon: SlidersHorizontal, title: "Set your strategy", body: "Pick your niche, audience, tone, video length, and how often you want to post." },
  { icon: CircleCheck, title: "Approve every video", body: "Vidora makes each video and waits. Approve it, reject it, or ask for changes." },
  { icon: CalendarClock, title: "We post on schedule", body: "Approved videos post at the time you picked, labeled as AI-generated." },
]

export default function Home() {
  return (
    <>
      <section className="safe-x mx-auto flex w-full max-w-[1280px] flex-col gap-6 py-16 md:px-6 md:py-24">
        <p className="font-display text-eyebrow text-primary-text uppercase">Coming soon</p>
        <h1 className="max-w-[16ch] font-display text-display-xl max-md:text-display-lg">
          Videos for your channels. You approve every one.
        </h1>
        <p className="max-w-[52ch] text-body-lg text-muted-foreground">
          Vidora makes short and long videos for YouTube and TikTok, then posts only the ones you approve.
        </p>
        {process.env.NODE_ENV !== "production" && (
          <div>
            <Button asChild variant="tertiary">
              <Link href="/design-system">Open the design system</Link>
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="how-title" className="bg-card">
        <div className="safe-x mx-auto w-full max-w-[1280px] py-16 md:px-6">
          <p className="font-display text-eyebrow text-muted-foreground uppercase">How it works</p>
          <h2 id="how-title" className="mt-3 font-display text-display-md">
            Four steps, and you stay in control
          </h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex flex-col gap-3 rounded-md bg-background p-6">
                <span className="flex size-12 items-center justify-center rounded-full bg-card text-primary-text">
                  <Icon aria-hidden className="size-6" strokeWidth={1.75} />
                </span>
                <p className="text-display-xs">
                  <span className="sr-only">Step {i + 1}: </span>
                  {title}
                </p>
                <p className="text-body-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="data-title" className="safe-x mx-auto w-full max-w-[1280px] py-16 md:px-6">
        <h2 id="data-title" className="font-display text-display-md">
          How Vidora uses your YouTube and TikTok access
        </h2>
        <div className="mt-6 grid max-w-[70ch] gap-4 text-body-md text-muted-foreground">
          <p>
            We use your YouTube and TikTok permissions for three things: to upload the videos you approve, to show your channel
            name and picture in Vidora, and to show how your posted videos perform.
          </p>
          <p>
            We never post without your approval. We don&apos;t sell your data, and we don&apos;t use your YouTube or TikTok data to
            train AI models. You can disconnect an account at any time.
          </p>
          <p>
            Read the full{" "}
            <Link href="/legal/privacy" className="text-primary-text underline underline-offset-4 hover:no-underline">
              privacy policy
            </Link>{" "}
            and{" "}
            <Link href="/legal/terms" className="text-primary-text underline underline-offset-4 hover:no-underline">
              terms of service
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  )
}
