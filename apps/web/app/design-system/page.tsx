import type { Metadata } from "next"
import Image from "next/image"
import { notFound } from "next/navigation"
import { CalendarClock, Inbox, Loader, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react"
import * as Icons from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/vidora/empty-state"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { Logo, LogoMark } from "@/components/vidora/logo"
import { PipelineStepper } from "@/components/vidora/pipeline-stepper"
import { RunProgressCard } from "@/components/vidora/run-progress"
import { PlatformChip, PlatformIcon } from "@/components/vidora/platform-chip"
import { STATUS, StatusPill, type VideoStatus } from "@/components/vidora/status-pill"
import { ThemeToggle } from "@/components/vidora/theme-toggle"
import { VideoFrame } from "@/components/vidora/video-frame"
import banned from "@/lib/banned-words.json"
import { ApprovalDemo, LiveContrastTable, ToastDemo } from "./demos"

// Internal component gallery. Off in production unless ENABLE_DESIGN_SYSTEM=true.
export const metadata: Metadata = { title: "Design system", robots: { index: false, follow: false } }

const SECTIONS = [
  ["brand", "Brand"],
  ["color", "Color"],
  ["contrast", "Contrast"],
  ["type", "Type"],
  ["space", "Spacing and radius"],
  ["buttons", "Buttons"],
  ["forms", "Forms"],
  ["status", "Status"],
  ["cards", "Cards"],
  ["icons", "Icons"],
  ["review", "Video review"],
  ["states", "States"],
  ["copy", "Copy"],
] as const

const PALETTE = [
  { token: "primary", hex: "#FF4F00", cls: "bg-brand-orange", note: "Primary CTA fill. Text only on ink, or 19px/700 labels." },
  { token: "primary-text ⊕", hex: "#C73E00", cls: "bg-[#c73e00]", note: "Orange text and links on light surfaces." },
  { token: "ink", hex: "#201515", cls: "bg-ink", note: "Headings, body text, secondary button, dark canvas." },
  { token: "ink-soft", hex: "#2F2A26", cls: "bg-ink-soft", note: "Dark-mode cards." },
  { token: "ink-mid", hex: "#36342E", cls: "bg-ink-mid", note: "Dark-mode raised surfaces and borders." },
  { token: "body", hex: "#605D52", cls: "bg-body", note: "Secondary text (light)." },
  { token: "body-mid", hex: "#939084", cls: "bg-body-mid", note: "Metadata 18px+, on canvas only." },
  { token: "mute", hex: "#C5C0B1", cls: "bg-mute", note: "Hairlines. Secondary text in dark mode." },
  { token: "canvas", hex: "#FFFEFB", cls: "bg-canvas", note: "Page background. Never pure white." },
  { token: "canvas-soft", hex: "#F8F4F0", cls: "bg-canvas-soft", note: "Cards and inset regions." },
]

const SEMANTIC = [
  { token: "success ⊕", cls: "bg-success", note: "Posted, approved" },
  { token: "warning ⊕", cls: "bg-warning", note: "Needs review, changes requested" },
  { token: "danger ⊕", cls: "bg-danger", note: "Failed, destructive confirm" },
]

const TYPE = [
  { token: "display-xl", cls: "font-display text-display-xl", spec: "Mona Sans 56/56 · 500", sample: "Videos that post themselves" },
  { token: "display-lg", cls: "font-display text-display-lg", spec: "Mona Sans 48/48 · 500", sample: "Review before it posts" },
  { token: "display-md", cls: "font-display text-display-md", spec: "Mona Sans 32/36 · 500 · +1px", sample: "Your queue" },
  { token: "display-sub-lg", cls: "text-display-sub-lg", spec: "Inter 48/49.92 · 500", sample: "Approve in one tap" },
  { token: "display-sub-md", cls: "text-display-sub-md", spec: "Inter 32/40 · 400", sample: "This week on TikTok" },
  { token: "display-sub-sm", cls: "text-display-sub-sm", spec: "Inter 24/30 · 600 · -0.6px", sample: "Card title" },
  { token: "display-xs", cls: "text-display-xs", spec: "Inter 20/25 · 700 · -0.5px", sample: "Inline heading" },
  { token: "body-lg", cls: "text-body-lg", spec: "Inter 20/30 · 400", sample: "Lead paragraph for marketing pages." },
  { token: "body-md", cls: "text-body-md", spec: "Inter 18/27 · 400", sample: "Default marketing body text." },
  { token: "body-md-strong", cls: "text-body-md-strong", spec: "Inter 18/27 · 600", sample: "Bold inline body." },
  { token: "body-sm", cls: "text-body-sm", spec: "Inter 16/24 · 400", sample: "Default app body text." },
  { token: "body-sm-strong", cls: "text-body-sm-strong", spec: "Inter 16/24 · 600", sample: "Labels and table headers." },
  { token: "caption", cls: "text-caption", spec: "Inter 14/21 · 400", sample: "Fine print and timestamps." },
  { token: "eyebrow", cls: "font-display text-eyebrow uppercase", spec: "Mona Sans 14/14 · 500 · +1px", sample: "How it works" },
  { token: "button-md ⊕", cls: "text-button-md", spec: "Inter 19/27 · 700 (DESIGN.md: 18/600)", sample: "Approve for Tue 6:00 PM" },
  { token: "button-sm", cls: "text-button-sm", spec: "Inter 14.4/14.4 · 700", sample: "Small button" },
]

const SPACING = [
  ["xxs", "0.5", 2],
  ["xs", "1", 4],
  ["sm", "2", 8],
  ["md", "3", 12],
  ["lg", "4", 16],
  ["xl", "6", 24],
  ["2xl", "8", 32],
  ["3xl", "12", 48],
  ["4xl", "16", 64],
] as const

const ICONS = [
  "Inbox", "Check", "X", "PencilLine", "CalendarClock", "CalendarDays", "Clock", "Play", "Pause", "Film", "Clapperboard",
  "Mic", "Captions", "Image", "FileText", "Lightbulb", "Sparkles", "Bell", "Settings", "CreditCard", "UsersRound", "Link2",
  "RefreshCw", "Trash2", "Search", "Filter", "ChevronDown", "ChevronRight", "ArrowLeft", "CircleAlert", "CircleCheck",
  "Info", "Upload", "Download", "Eye", "Heart", "MessageCircle", "Share2", "ChartNoAxesColumn", "Wallet",
] as const

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-border py-12 first:border-t-0">
      <h2 id={`${id}-title`} className="font-display text-display-md">
        {title}
      </h2>
      {intro && <p className="mt-2 max-w-[70ch] text-body-md text-muted-foreground">{intro}</p>}
      <div className="mt-8 flex flex-col gap-8">{children}</div>
    </section>
  )
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-display text-eyebrow text-muted-foreground uppercase">{title}</h3>
      {children}
    </div>
  )
}

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DESIGN_SYSTEM !== "true") notFound()

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="safe-x mx-auto flex max-w-[1280px] items-center justify-between gap-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Logo width={112} priority />
            <span className="rounded-full bg-muted px-3 py-1 text-caption text-muted-foreground">Design system</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="safe-x mx-auto grid w-full max-w-[1280px] gap-10 md:px-6 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Sections" className="min-w-0 lg:sticky lg:top-20 lg:self-start lg:py-12">
          <ul className="-mx-1 flex gap-1 overflow-x-auto py-4 lg:flex-col lg:py-0">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="flex min-h-11 items-center rounded-sm px-3 text-body-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 pb-16">
          <div className="pt-12 pb-4">
            <p className="font-display text-eyebrow text-primary-text uppercase">Internal</p>
            <h1 className="mt-3 font-display text-display-lg max-md:text-display-md">Vidora design system</h1>
            <p className="mt-4 max-w-[70ch] text-body-lg text-muted-foreground">
              Tokens, components, and states for every Vidora screen. DESIGN.md is the source of truth. Items marked ⊕ are
              Vidora extensions recorded in the vidora-design skill.
            </p>
          </div>

          <Section id="brand" title="Brand" intro="Generated from the master logo with pnpm brand. Never recolor or redraw the logo.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex min-h-48 items-center justify-center rounded-md bg-canvas p-8 ring-1 ring-mute">
                <Image src="/brand/vidora-logo.svg" alt="Vidora logo on canvas" width={224} height={63} unoptimized />
              </div>
              <div className="flex min-h-48 items-center justify-center rounded-md bg-ink p-8">
                <Image src="/brand/vidora-logo-dark.svg" alt="Vidora dark-mode logo on ink" width={224} height={63} unoptimized />
              </div>
              <div className="flex min-h-48 items-center justify-center gap-8 rounded-md bg-canvas-soft p-8">
                <LogoMark size={72} />
                <Image src="/brand/app-icon-1024.png" alt="Vidora app icon" width={80} height={80} className="rounded-md" />
                <Image src="/brand/app-icon-dark-1024.png" alt="Vidora app icon, dark" width={80} height={80} className="rounded-md" />
              </div>
              <div className="flex min-h-48 flex-col justify-end gap-2 rounded-md bg-brand-gradient p-6 text-ink">
                <p className="text-body-sm-strong">Logo gradient ⊕ · 140deg · #FD9A1B to #FD4E4E</p>
                <p className="text-body-sm">Decorative only: logo, icons, OG image, progress, illustrations. Never text or buttons.</p>
              </div>
            </div>
          </Section>

          <Section id="color" title="Color" intro="Orange, cream, and coffee is the whole palette. Every neutral is warm.">
            <Sub title="DESIGN.md palette">
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {PALETTE.map((c) => (
                  <li key={c.token} className="flex items-center gap-4 rounded-md bg-card p-3">
                    <span aria-hidden className={`size-14 shrink-0 rounded-sm ring-1 ring-ink/10 ${c.cls}`} />
                    <div className="min-w-0">
                      <p className="text-body-sm-strong">{c.token}</p>
                      <p className="tabular font-mono text-caption text-muted-foreground">{c.hex}</p>
                      <p className="text-caption text-muted-foreground">{c.note}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Sub>
            <Sub title="Status colors ⊕ (follow light/dark)">
              <ul className="grid gap-3 sm:grid-cols-3">
                {SEMANTIC.map((c) => (
                  <li key={c.token} className="flex items-center gap-4 rounded-md bg-card p-3">
                    <span aria-hidden className={`size-14 shrink-0 rounded-sm ${c.cls}`} />
                    <div>
                      <p className="text-body-sm-strong">{c.token}</p>
                      <p className="text-caption text-muted-foreground">{c.note}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Sub>
          </Section>

          <Section id="contrast" title="Contrast" intro="WCAG AA: 4.5:1 for text, 3:1 for large text (24px, or 18.66px bold) and for borders and focus rings. Switch the theme to check dark mode.">
            <LiveContrastTable />
          </Section>

          <Section id="type" title="Type" intro="Mona Sans for hero and eyebrow, Inter for everything else. Sentence case.">
            <ul className="flex flex-col divide-y divide-border">
              {TYPE.map((t) => (
                <li key={t.token} className="grid gap-2 py-4 md:grid-cols-[220px_1fr] md:items-baseline">
                  <div>
                    <p className="font-mono text-caption text-foreground">{t.token}</p>
                    <p className="text-caption text-muted-foreground">{t.spec}</p>
                  </div>
                  <p className={`${t.cls} break-words`}>{t.sample}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="space" title="Spacing and radius" intro="4px base. DESIGN.md names map to Tailwind steps, so spacing.xl (24px) is p-6.">
            <ul className="flex flex-col gap-2">
              {SPACING.map(([name, step, px]) => (
                <li key={name} className="grid grid-cols-[64px_72px_1fr] items-center gap-3 text-body-sm">
                  <span className="font-mono text-caption">{name}</span>
                  <span className="tabular text-caption text-muted-foreground">
                    {px}px · {step}
                  </span>
                  <span aria-hidden className="h-4 rounded-sm bg-primary" style={{ width: px }} />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-4">
              {[
                ["sm · 6px", "rounded-sm", "Inputs, inline pills"],
                ["md · 12px", "rounded-md", "Buttons, cards"],
                ["pill", "rounded-full", "Badges, chips"],
              ].map(([label, cls, use]) => (
                <div key={label} className="flex flex-col items-center gap-2">
                  <span aria-hidden className={`size-20 border border-foreground bg-card ${cls}`} />
                  <span className="text-body-sm-strong">{label}</span>
                  <span className="text-caption text-muted-foreground">{use}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="buttons" title="Buttons" intro="12px radius, never pills. At most two filled buttons per view.">
            <Sub title="Variants">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Approve for Tue 6:00 PM</Button>
                <Button variant="secondary">Request changes</Button>
                <Button variant="tertiary">Reject</Button>
                <Button variant="text">Cancel</Button>
                <Button variant="link">View post history</Button>
              </div>
            </Sub>
            <Sub title="Sizes">
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg">Large · 56px</Button>
                <Button>Default · 48px</Button>
                <Button size="sm">Small · 44px</Button>
                <Button variant="secondary" size="sm">
                  Small secondary
                </Button>
                <Button variant="tertiary" size="icon" aria-label="Search">
                  <Search />
                </Button>
              </div>
            </Sub>
            <Sub title="States">
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled>Disabled</Button>
                <Button disabled aria-busy>
                  <Loader className="animate-spin motion-reduce:animate-none" aria-hidden />
                  Saving
                </Button>
                <Button variant="tertiary">
                  <RefreshCw aria-hidden />
                  Try again
                </Button>
                <Button variant="destructive">
                  <Trash2 aria-hidden />
                  Delete video
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">
                Press Tab to see focus rings: 2px orange outline, 2px offset. Destructive buttons only appear inside a confirm dialog.
              </p>
            </Sub>
          </Section>

          <Section id="forms" title="Forms" intro="Canvas fill, 1px ink border, 6px radius. Labels sit above fields. Errors say how to fix them.">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ds-niche" className="text-body-sm-strong">
                  Niche
                </Label>
                <Input id="ds-niche" placeholder="Example: Personal finance tips" />
                <p className="text-caption text-muted-foreground">One topic area. You can add more strategies later.</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ds-handle" className="text-body-sm-strong">
                  Channel name
                </Label>
                <Input id="ds-handle" aria-invalid aria-describedby="ds-handle-error" defaultValue="@" />
                <p id="ds-handle-error" className="text-caption text-danger">
                  Enter your channel name after the @.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ds-length" className="text-body-sm-strong">
                  Video length
                </Label>
                <Select defaultValue="short">
                  <SelectTrigger id="ds-length" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short (under 60 seconds)</SelectItem>
                    <SelectItem value="long">Long (8 to 12 minutes)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ds-caption" className="text-body-sm-strong">
                  Caption
                </Label>
                <Textarea id="ds-caption" defaultValue="3 money habits that changed my 20s. Which one are you starting today?" />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-md bg-card p-4 md:col-span-2">
                <div>
                  <Label htmlFor="ds-comments" className="text-body-sm-strong">
                    Allow comments
                  </Label>
                  <p className="text-caption text-muted-foreground">TikTok asks you to choose this for every post.</p>
                </div>
                <Switch id="ds-comments" defaultChecked />
              </div>
              <Tabs defaultValue="queue" className="md:col-span-2">
                <TabsList>
                  <TabsTrigger value="queue">Needs review</TabsTrigger>
                  <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
                  <TabsTrigger value="failed">Failed</TabsTrigger>
                </TabsList>
                <TabsContent value="queue" className="pt-3 text-body-sm text-muted-foreground">
                  Tabs filter the queue. Each tab is 44px tall.
                </TabsContent>
                <TabsContent value="scheduled" className="pt-3 text-body-sm text-muted-foreground">
                  Scheduled videos.
                </TabsContent>
                <TabsContent value="failed" className="pt-3 text-body-sm text-muted-foreground">
                  Videos that didn&apos;t finish or didn&apos;t post.
                </TabsContent>
              </Tabs>
            </div>
          </Section>

          <Section id="status" title="Status" intro="Every status has an icon, a label, and a color. Never color alone.">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(STATUS) as VideoStatus[]).map((s) => (
                <StatusPill key={s} status={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <PlatformChip platform="youtube" />
              <PlatformChip platform="tiktok" account="@moneyhabits" />
            </div>
          </Section>

          <Section id="cards" title="Cards" intro="Cream card on cream canvas. The surface change is the elevation, so cards have no shadow.">
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Personal finance</CardTitle>
                  <CardDescription>3 shorts a week · English · Calm and clear</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <PlatformChip platform="youtube" />
                  <PlatformChip platform="tiktok" />
                </CardContent>
                <CardFooter>
                  <Button variant="tertiary" size="sm">
                    Edit strategy
                  </Button>
                </CardFooter>
              </Card>
              <div className="flex flex-col gap-3 rounded-md bg-ink p-6 text-on-primary">
                <p className="font-display text-eyebrow text-mute uppercase">Feature card · dark</p>
                <p className="text-display-sub-sm">You approve every video</p>
                <p className="text-body-sm text-mute">Nothing posts until you say so.</p>
              </div>
              <div className="flex flex-col gap-3 rounded-md border border-foreground bg-background p-6">
                <p className="font-display text-eyebrow uppercase">Pricing card</p>
                <p className="text-display-sub-sm">Creator</p>
                <p className="text-body-sm text-muted-foreground">
                  <span className="tabular text-display-xs text-foreground">$39</span> a month · about 8 shorts
                </p>
              </div>
            </div>
          </Section>

          <Section id="icons" title="Icons" intro="Lucide only, inline SVG, stroke 1.75, currentColor. Icon buttons get a 44px hit area.">
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {ICONS.map((name) => {
                const Icon = Icons[name] as Icons.LucideIcon
                return (
                  <li key={name} className="flex flex-col items-center gap-1 rounded-sm p-2 text-center">
                    <Icon aria-hidden className="size-6" strokeWidth={1.75} />
                    <span className="text-caption break-all text-muted-foreground">{name}</span>
                  </li>
                )
              })}
            </ul>
            <div className="flex items-center gap-4 text-body-sm text-muted-foreground">
              <PlatformIcon platform="youtube" className="size-6 text-foreground" />
              <PlatformIcon platform="tiktok" className="size-6 text-foreground" />
              Platform marks come from simple-icons, one color only.
            </div>
          </Section>

          <Section
            id="review"
            title="Video review"
            intro="The approval flow. On desktop, try A, R, and C on your keyboard. On a phone, the three buttons sit in the thumb zone."
          >
            <div className="grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
              <VideoFrame duration="0:42" caption="3 money habits that changed my 20s" className="mx-auto w-full max-w-[320px]" />
              <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status="pending_approval" />
                  <PlatformChip platform="tiktok" account="@moneyhabits" />
                  <span className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground">
                    <CalendarClock aria-hidden className="size-4" strokeWidth={1.75} />
                    Tue 6:00 PM
                  </span>
                </div>
                <Sub title="Pipeline · generating">
                  <PipelineStepper current={3} />
                </Sub>
                <Sub title="Pipeline · failed at voice">
                  <PipelineStepper current={2} failed />
                </Sub>
                {/* Fixed times so the demo renders the same every time. */}
                {[
                  { title: "Run progress · starting (Run now pressed)", status: "planned", scenesTotal: 0, scenesDone: 0, startedAt: null },
                  { title: "Run progress · planning", status: "generating", scenesTotal: 0, scenesDone: 0, startedAt: new Date("2026-10-23T04:00:00Z") },
                  { title: "Run progress · scene clips 3 of 6", status: "generating", scenesTotal: 6, scenesDone: 3, startedAt: new Date("2026-10-23T03:56:00Z") },
                  { title: "Run progress · editing", status: "assembling", scenesTotal: 6, scenesDone: 6, startedAt: new Date("2026-10-23T03:49:00Z") },
                  { title: "Run progress · posting", status: "uploading", scenesTotal: 6, scenesDone: 6, startedAt: new Date("2026-10-23T03:47:00Z") },
                ].map((d) => (
                  <Sub key={d.title} title={d.title}>
                    <RunProgressCard
                      status={d.status}
                      title={d.scenesTotal ? "3 AI Side Jobs You Can Start During Nap Time" : null}
                      hook={d.scenesTotal ? "Three AI side jobs you can start during nap time. Number one surprised me." : null}
                      scenesTotal={d.scenesTotal}
                      scenesDone={d.scenesDone}
                      startedAt={d.startedAt}
                      estimateCredits={d.scenesTotal ? 60 : null}
                      now={new Date("2026-10-23T04:01:00Z")}
                    />
                  </Sub>
                ))}
                <Sub title="Action bar · desktop">
                  <ApprovalDemo layout="desktop" />
                </Sub>
                <Sub title="Action bar · phone">
                  <div className="max-w-[390px] rounded-md border border-border p-4">
                    <ApprovalDemo layout="mobile" />
                  </div>
                </Sub>
                <Sub title="Toasts">
                  <ToastDemo />
                </Sub>
              </div>
            </div>
          </Section>

          <Section id="states" title="States" intro="Every screen ships with empty, loading, and error states.">
            <div className="grid gap-6 lg:grid-cols-2">
              <EmptyState
                icon={Inbox}
                title="Nothing to review right now"
                body="Your next videos start generating at 9:00 AM."
                action={
                  <Button>
                    <Sparkles aria-hidden />
                    Make a video now
                  </Button>
                }
              />
              <div role="status" aria-busy aria-label="Loading queue" className="flex flex-col gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-4 rounded-md bg-card p-4">
                    <Skeleton className="aspect-[9/16] w-16 rounded-sm bg-mute/50 dark:bg-mute/20" />
                    <div className="flex flex-1 flex-col gap-2 py-1">
                      <Skeleton className="h-4 w-3/4 bg-mute/50 dark:bg-mute/20" />
                      <Skeleton className="h-4 w-1/2 bg-mute/50 dark:bg-mute/20" />
                      <Skeleton className="mt-auto h-6 w-24 rounded-full bg-mute/50 dark:bg-mute/20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <InlineAlert
              title="We couldn't post to TikTok."
              action={
                <Button variant="tertiary" size="sm">
                  Reconnect TikTok
                </Button>
              }
            >
              Your TikTok login expired. Reconnect it and we&apos;ll try again.
            </InlineAlert>
            <InlineAlert tone="success" title="Posted to YouTube.">
              Your video is live. Views show up in post history within an hour.
            </InlineAlert>
          </Section>

          <Section id="copy" title="Copy" intro="Friendly and direct. Say what the screen does, then give one next step.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md bg-card p-6">
                <p className="text-body-sm-strong">Write like this</p>
                <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-body-sm text-muted-foreground">
                  <li>Buttons name the action: “Approve for Tue 6:00 PM”, “Reconnect TikTok”.</li>
                  <li>Errors say what happened and what to do next, without blame.</li>
                  <li>US English, contractions, sentence case, no exclamation marks in the app.</li>
                  <li>“You” for the reader, “we” for Vidora.</li>
                </ul>
              </div>
              <div className="rounded-md bg-card p-6">
                <p className="text-body-sm-strong">Banned words · checked by pnpm copy-lint</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {[...banned.words, ...banned.labels].map((w) => (
                    <li key={w} className="rounded-full bg-background px-3 py-1 text-caption text-muted-foreground line-through decoration-danger">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>
        </main>
      </div>
    </div>
  )
}
