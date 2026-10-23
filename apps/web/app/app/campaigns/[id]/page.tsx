import { describeSchedule } from "@vidora/core/schedule"
import { getCampaign, getDb, listRuns, runSceneProgress, videosForRuns } from "@vidora/db"
import { ArrowLeft, ExternalLink, Eye, Film } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { LiveRefresh } from "@/components/vidora/live-refresh"
import { RunProgressCard } from "@/components/vidora/run-progress"
import { CAMPAIGN_STATUS, MODE_LABEL, PAUSE_REASON, RUN_STATUS, StatusBadge } from "@/components/vidora/run-status"
import { customerText } from "@/lib/customer-text"
import { requireSession } from "@/lib/server/session"
import { getStorage } from "@/lib/server/storage"
import { CampaignControls } from "./controls"

// A campaign: its controls, the runs in progress (live), the next booked slots, and past runs.
// While anything is in progress the page refreshes itself every few seconds (LiveRefresh).

const IN_PROGRESS = new Set(["generating", "assembling", "uploading"])

export default function CampaignPage({ params, searchParams }: PageProps<"/app/campaigns/[id]">) {
  return (
    <div className="flex flex-col gap-8">
      <Link href="/app/campaigns" className="inline-flex min-h-11 w-fit items-center gap-2 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-5" strokeWidth={1.75} />
        Campaigns
      </Link>
      <Suspense fallback={<Skeleton className="h-96 w-full bg-muted" />}>
        <Campaign params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

/** The time a page render happens; kept out of components so they stay pure. */
const renderTime = () => new Date()

async function Campaign({ params, searchParams }: Pick<PageProps<"/app/campaigns/[id]">, "params" | "searchParams">) {
  const { id } = await params
  const created = (await searchParams).created === "1"
  const s = await requireSession(`/app/campaigns/${id}`)
  const db = getDb()
  const c = await getCampaign(db, s.workspaceId, id)
  if (!c) notFound()
  const { campaign, schedule } = c
  const runs = await listRuns(db, s.workspaceId, id, { limit: 40 })
  const tz = schedule.timeZone
  const now = renderTime()
  const when = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

  // A Run now shows as in progress straight away, before the worker picks it up.
  const active = runs.filter((r) => IN_PROGRESS.has(r.status) || (r.status === "planned" && r.trigger === "run_now"))
  const upcoming = runs.filter((r) => r.status === "planned" && r.trigger !== "run_now").sort((a, b) => a.slotAt.getTime() - b.slotAt.getTime())
  const history = runs.filter((r) => r.status !== "planned" && !IN_PROGRESS.has(r.status))
  const [scenesDone, finished] = await Promise.all([runSceneProgress(db, active.map((r) => r.id)), videosForRuns(db, s.workspaceId, history.map((r) => r.id))])
  const storage = getStorage()
  const thumbs = new Map(
    await Promise.all(
      [...finished].filter(([, v]) => v.thumbnailKey).map(async ([runId, v]) => [runId, await storage.presignGet(v.thumbnailKey!, { expiresSec: 3600 })] as const)
    )
  )

  return (
    <>
      <LiveRefresh active={active.length > 0} />
      {created && (
        <InlineAlert tone="success" title="Campaign started">
          The first video starts {upcoming[0] ? `generating ${when(upcoming[0].generateAt)}` : "soon"}. Press Run now to make one right away.
        </InlineAlert>
      )}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-display-md">{campaign.name}</h1>
          <StatusBadge status={campaign.status} map={CAMPAIGN_STATUS} />
        </div>
        <p className="text-body-md text-muted-foreground">
          {MODE_LABEL[campaign.mode]} · {describeSchedule(schedule)} ({tz}) · {campaign.publishMode === "auto" ? "Posts automatically" : "Asks you first"} · Variety: {campaign.variationIntensity}
        </p>
        {campaign.status === "paused" && campaign.pauseReason && (
          <InlineAlert tone={campaign.pauseReason === "user" ? "info" : "danger"} title="This campaign is paused">
            {customerText(campaign.pauseMessage, PAUSE_REASON[campaign.pauseReason]) ?? PAUSE_REASON[campaign.pauseReason]} Resume it when you&apos;re ready.
          </InlineAlert>
        )}
        <CampaignControls id={campaign.id} status={campaign.status} />
      </div>

      {active.length > 0 && (
        <section aria-labelledby="in-progress" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="in-progress" className="text-display-xs">
              In progress
            </h2>
            <p className="text-caption text-muted-foreground">Updates live. A video takes about 5 to 15 minutes.</p>
          </div>
          <ul aria-live="polite" className="flex flex-col gap-3">
            {active.map((r) => (
              <li key={r.id}>
                <RunProgressCard
                  status={r.status}
                  title={r.plan?.title ?? null}
                  hook={r.plan?.hook ?? null}
                  scenesTotal={r.plan?.scenes.length ?? 0}
                  scenesDone={scenesDone.get(r.id) ?? 0}
                  startedAt={r.startedAt}
                  estimateCredits={r.estimateCredits}
                  now={now}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="upcoming" className="flex flex-col gap-3">
        <h2 id="upcoming" className="text-display-xs">
          Upcoming
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{campaign.status === "active" ? "The next posting slots are booked within a minute." : "Nothing booked while the campaign is paused."}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-card p-4">
                <div className="flex flex-col">
                  <span className="tabular text-body-sm-strong text-foreground">Posts {when(r.slotAt)}</span>
                  <span className="tabular text-caption text-muted-foreground">Starts generating {when(r.generateAt)}</span>
                </div>
                <StatusBadge status={r.status} map={RUN_STATUS} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="text-display-xs">
          Runs
        </h2>
        {history.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No finished runs yet. Press Run now to make the first video.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((r) => {
              const thumb = thumbs.get(r.id)
              const youtubeUrl = finished.get(r.id)?.youtubeUrl
              return (
                <li key={r.id} className="flex gap-4 rounded-md bg-card p-4">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, not a static asset
                    <img src={thumb} alt="" className="aspect-[9/16] w-16 shrink-0 rounded-sm bg-muted object-cover sm:w-20" />
                  ) : (
                    <span aria-hidden className="flex aspect-[9/16] w-16 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground sm:w-20">
                      <Film className="size-5" strokeWidth={1.75} />
                    </span>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-body-sm-strong text-foreground">{r.plan?.title ?? (r.trigger === "run_now" ? "Run now" : "Scheduled run")}</span>
                        <span className="tabular text-caption text-muted-foreground">
                          Slot {when(r.slotAt)}
                          {r.estimateCredits ? ` · about ${Math.round(r.estimateCredits)} credits` : ""}
                        </span>
                      </div>
                      <StatusBadge status={r.status} map={RUN_STATUS} className="shrink-0" />
                    </div>
                    {r.plan?.hook && <p className="text-body-sm text-muted-foreground">Hook: {r.plan.hook}</p>}
                    {r.status === "failed" && r.errorMessage && <p className="text-body-sm text-danger">{customerText(r.errorMessage)}</p>}
                    {r.status === "skipped" && r.errorMessage && <p className="text-body-sm text-muted-foreground">{customerText(r.errorMessage)}</p>}
                    {(r.status === "awaiting_approval" || youtubeUrl) && (
                      <div className="flex flex-wrap gap-3">
                        {r.status === "awaiting_approval" && (
                          <Button variant="tertiary" size="sm" asChild>
                            <Link href={`/app/approvals/${r.id}`}>
                              <Eye aria-hidden />
                              Review video
                            </Link>
                          </Button>
                        )}
                        {youtubeUrl && (
                          <a href={youtubeUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-body-sm text-primary-text underline underline-offset-4">
                            Open on YouTube
                            <ExternalLink aria-hidden className="size-4" strokeWidth={1.75} />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
