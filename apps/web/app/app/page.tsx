import { monthStart } from "@vidora/core"
import { getDb, listCampaigns, listVideos, upcomingRuns, workspaceSpend } from "@vidora/db"
import { Plus } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RUN_STATUS, StatusBadge } from "@/components/vidora/run-status"
import { VideoCard } from "@/components/vidora/video-card"
import { requireSession } from "@/lib/server/session"
import { getStorage } from "@/lib/server/storage"

export default function Dashboard() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-display-md">Dashboard</h1>
          <p className="text-body-md text-muted-foreground">What&apos;s posting next, what it costs, and your latest Shorts.</p>
        </div>
        <Button asChild>
          <Link href="/app/campaigns/new">
            <Plus aria-hidden />
            New campaign
          </Link>
        </Button>
      </div>
      <Suspense fallback={<Skeleton className="h-[480px] w-full bg-muted" />}>
        <Overview />
      </Suspense>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-card p-5">
      <p className="text-body-sm text-muted-foreground">{label}</p>
      <p className="tabular text-display-xs text-foreground">{value}</p>
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
    </div>
  )
}

async function Overview() {
  const s = await requireSession("/app")
  const db = getDb()
  const [campaigns, upcoming, videos, spend] = await Promise.all([
    listCampaigns(db, s.workspaceId),
    upcomingRuns(db, s.workspaceId, 6),
    listVideos(db, s.workspaceId, { limit: 3 }),
    workspaceSpend(db, s.workspaceId, monthStart("Asia/Manila")),
  ])
  const active = campaigns.filter((c) => c.campaign.status === "active").length
  const paused = campaigns.filter((c) => c.campaign.status === "paused").length
  const storage = getStorage()

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Credits used this month" value={new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(spend.spentCredits)} hint={spend.heldCredits > 0 ? `${Math.round(spend.heldCredits)} more in progress` : undefined} />
        <Stat label="Campaigns" value={`${active} active`} hint={paused ? `${paused} paused` : undefined} />
      </div>

      <section aria-labelledby="next" className="flex flex-col gap-3">
        <h2 id="next" className="text-display-xs">
          Coming up
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">Nothing booked. Start a campaign, and its next posting slots show here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map(({ run, campaignName, timeZone }) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-card p-4">
                <div className="flex min-w-0 flex-col">
                  <Link href={`/app/campaigns/${run.campaignId}`} className="truncate text-body-sm-strong text-foreground hover:underline">
                    {run.plan?.title ?? campaignName}
                  </Link>
                  <span className="tabular text-caption text-muted-foreground">
                    {campaignName} · posts {run.slotAt.toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                <StatusBadge status={run.status} map={RUN_STATUS} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {videos.length > 0 && (
        <section aria-labelledby="recent" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="recent" className="text-display-xs">
              Latest videos
            </h2>
            <Link href="/app/library" className="inline-flex min-h-11 items-center text-body-sm text-primary-text underline underline-offset-4">
              Open the library
            </Link>
          </div>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {await Promise.all(
              videos.map(async ({ video: v, campaignName }) => (
                <li key={v.id}>
                  <VideoCard
                    src={v.storageKey ? await storage.presignGet(v.storageKey, { expiresSec: 3600 }) : null}
                    poster={v.thumbnailKey ? await storage.presignGet(v.thumbnailKey, { expiresSec: 3600 }) : null}
                    title={v.title ?? "Untitled Short"}
                    campaign={campaignName}
                    status={v.status}
                    youtubeUrl={v.youtubeUrl}
                  />
                </li>
              ))
            )}
          </ul>
        </section>
      )}
    </>
  )
}
