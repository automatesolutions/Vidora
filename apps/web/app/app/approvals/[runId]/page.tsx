import { getCampaign, getDb, getRun, getVideoByRun, listAccounts } from "@vidora/db"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { MODE_LABEL, RUN_STATUS, StatusBadge } from "@/components/vidora/run-status"
import { requireSession } from "@/lib/server/session"
import { getStorage } from "@/lib/server/storage"
import { ReviewForm } from "./review-form"

// The review page every video gets before it's scheduled (campaigns set to "Ask me first").
export default function ReviewPage({ params }: PageProps<"/app/approvals/[runId]">) {
  return (
    <div className="flex flex-col gap-8">
      <Link href="/app/approvals" className="inline-flex min-h-11 w-fit items-center gap-2 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-5" strokeWidth={1.75} />
        Approvals
      </Link>
      <Suspense fallback={<Skeleton className="h-[640px] w-full bg-muted" />}>
        <Review params={params} />
      </Suspense>
    </div>
  )
}

/** "2026-10-20T18:00" in `timeZone`, for a datetime-local input. */
function localInput(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date)
  const g = (t: string) => p.find((x) => x.type === t)!.value
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`
}

/** The booked slot, or 30 minutes from now if the slot already passed. */
function suggestedPostTime(slotAt: Date) {
  return new Date(Math.max(slotAt.getTime(), Date.now() + 30 * 60_000))
}

async function Review({ params }: Pick<PageProps<"/app/approvals/[runId]">, "params">) {
  const { runId } = await params
  const s = await requireSession(`/app/approvals/${runId}`)
  const db = getDb()
  const run = await getRun(db, runId)
  if (!run || run.workspaceId !== s.workspaceId) notFound()
  const [video, c, accounts] = await Promise.all([getVideoByRun(db, runId), getCampaign(db, s.workspaceId, run.campaignId), listAccounts(db, s.workspaceId)])
  if (!video || !c) notFound()
  const storage = getStorage()
  const src = video.storageKey ? await storage.presignGet(video.storageKey, { expiresSec: 3600 }) : null
  const poster = video.thumbnailKey ? await storage.presignGet(video.thumbnailKey, { expiresSec: 3600 }) : null
  const tz = c.schedule.timeZone
  const plan = run.plan
  const channel = accounts.find((a) => a.id === c.campaign.youtubeAccountId && a.status === "active") ?? accounts.find((a) => a.status === "active")
  const suggested = suggestedPostTime(run.slotAt)

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,360px)_1fr]">
      <div className="flex flex-col gap-3">
        {src ? (
          <video controls playsInline preload="metadata" src={src} poster={poster ?? undefined} className="mx-auto aspect-[9/16] w-full max-w-[360px] rounded-md bg-black" />
        ) : (
          <div className="flex aspect-[9/16] w-full items-center justify-center rounded-md bg-muted text-body-sm text-muted-foreground">The video isn&apos;t ready yet.</div>
        )}
        <p className="tabular text-caption text-muted-foreground">
          {video.durationMs ? `${Math.round(video.durationMs / 1000)} seconds · ` : ""}
          {run.estimateCredits ? `about ${Math.round(run.estimateCredits)} credits` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-display-md">Review before it posts</h1>
            <StatusBadge status={run.status} map={RUN_STATUS} />
          </div>
          <p className="text-body-md text-muted-foreground">
            {c.campaign.name} · {MODE_LABEL[c.campaign.mode]}
          </p>
        </div>

        {run.status === "awaiting_approval" ? (
          <ReviewForm
            runId={run.id}
            timeZone={tz}
            channel={channel?.displayName ?? null}
            initial={{
              title: video.title ?? plan?.title ?? "",
              description: plan?.description ?? "",
              hashtags: plan?.hashtags ?? [],
              postAt: localInput(suggested, tz),
            }}
          />
        ) : (
          <InlineAlert tone="info" title="Already decided">
            This video is {RUN_STATUS[run.status]?.label.toLowerCase() ?? run.status}. Nothing to approve here.
          </InlineAlert>
        )}

        {plan && (
          <section aria-labelledby="inside" className="flex flex-col gap-4 rounded-md bg-card p-6">
            <h2 id="inside" className="text-display-xs">
              What&apos;s in it
            </h2>
            <p className="text-body-sm text-foreground">
              <span className="text-body-sm-strong">Hook:</span> {plan.hook}
            </p>
            <ol className="flex flex-col gap-3">
              {plan.scenes.map((sc, i) => (
                <li key={i} className="flex flex-col gap-1 border-t border-border pt-3 first:border-0 first:pt-0">
                  <span className="tabular text-caption text-muted-foreground">
                    Scene {i + 1} · {sc.duration_sec} s · caption &ldquo;{sc.caption_words}&rdquo;
                  </span>
                  <span className="text-body-sm text-foreground">{sc.voiceover_line}</span>
                </li>
              ))}
            </ol>
            {run.variation && (
              <p className="text-caption text-muted-foreground">
                Style: {[run.variation.visual_style, run.variation.camera_language, run.variation.pacing].filter(Boolean).join(" · ")}
              </p>
            )}
            {plan.warnings && plan.warnings.length > 0 && (
              <InlineAlert tone="info" title="Notes from the director">
                {plan.warnings.join(" ")}
              </InlineAlert>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
