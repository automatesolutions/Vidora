import { describeSchedule } from "@vidora/core/schedule"
import { getDb, listCampaigns } from "@vidora/db"
import { Megaphone, Plus } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/vidora/empty-state"
import { CAMPAIGN_STATUS, MODE_LABEL, StatusBadge } from "@/components/vidora/run-status"
import { requireSession } from "@/lib/server/session"

export default function CampaignsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-display-md">Campaigns</h1>
          <p className="text-body-md text-muted-foreground">Each campaign makes a new Short on its schedule.</p>
        </div>
        <Button asChild>
          <Link href="/app/campaigns/new">
            <Plus aria-hidden />
            New campaign
          </Link>
        </Button>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full bg-muted" />}>
        <List />
      </Suspense>
    </div>
  )
}

async function List() {
  const s = await requireSession("/app/campaigns")
  const rows = (await listCampaigns(getDb(), s.workspaceId)).filter((r) => r.campaign.status !== "archived")
  if (rows.length === 0) {
    return <EmptyState icon={Megaphone} title="No campaigns yet" body="Set one up once, and it makes a new Short before every posting slot." />
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map(({ campaign: c, schedule }) => (
        <li key={c.id}>
          <Link href={`/app/campaigns/${c.id}`} className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-card p-5 transition-colors hover:bg-muted">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-body-md-strong text-foreground">{c.name}</p>
              <p className="text-body-sm text-muted-foreground">
                {MODE_LABEL[c.mode]} · {describeSchedule(schedule)} · {schedule.timeZone}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {c.status === "active" && c.nextRunAt && (
                <span className="tabular text-body-sm text-muted-foreground">
                  Next {c.nextRunAt.toLocaleString("en-US", { timeZone: schedule.timeZone, weekday: "short", hour: "numeric", minute: "2-digit" })}
                </span>
              )}
              <StatusBadge status={c.status} map={CAMPAIGN_STATUS} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
