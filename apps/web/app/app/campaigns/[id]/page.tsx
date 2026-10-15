import { describeSchedule } from "@vidora/core/schedule"
import { getCampaign, getDb, listRuns } from "@vidora/db"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { CAMPAIGN_STATUS, MODE_LABEL, PAUSE_REASON, RUN_STATUS, StatusBadge } from "@/components/vidora/run-status"
import { requireSession } from "@/lib/server/session"
import { CampaignControls } from "./controls"

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
  const when = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  const upcoming = runs.filter((r) => r.status === "planned").sort((a, b) => a.slotAt.getTime() - b.slotAt.getTime())
  const history = runs.filter((r) => r.status !== "planned")

  return (
    <>
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
            {campaign.pauseMessage ?? PAUSE_REASON[campaign.pauseReason]} Resume it when you&apos;re ready.
          </InlineAlert>
        )}
        <CampaignControls id={campaign.id} status={campaign.status} />
      </div>

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
                <StatusBadge status={r.trigger === "run_now" ? "planned" : r.status} map={RUN_STATUS} />
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
          <p className="text-body-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-md bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-body-sm-strong text-foreground">{r.plan?.title ?? (r.trigger === "run_now" ? "Run now" : "Scheduled run")}</span>
                    <span className="tabular text-caption text-muted-foreground">
                      Slot {when(r.slotAt)}
                      {r.estimateCredits ? ` · about ${Math.round(r.estimateCredits)} credits` : ""}
                    </span>
                  </div>
                  <StatusBadge status={r.status} map={RUN_STATUS} />
                </div>
                {r.plan?.hook && <p className="text-body-sm text-muted-foreground">Hook: {r.plan.hook}</p>}
                {r.status === "failed" && r.errorMessage && <p className="text-body-sm text-danger">{r.errorMessage}</p>}
                {r.status === "skipped" && r.errorMessage && <p className="text-body-sm text-muted-foreground">{r.errorMessage}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
