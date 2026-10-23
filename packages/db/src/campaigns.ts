import { newId, runNowSlot, upcomingSlots, type PauseReason, type ScheduleInput } from "@vidora/core"
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm"
import type { DbOrTx } from "./client"
import { campaigns, generationJobs, runs, schedules, videos, type Campaign, type CampaignBrief, type ModelPrefs, type Schedule } from "./schema"
import { inWorkspace } from "./scoped"

// Campaigns and their schedules. A campaign is set up once; the scheduler books one run per posting
// slot (unique per campaign and slot, so booking twice is harmless).

export type NewCampaign = {
  workspaceId: string
  createdBy: string | null
  name: string
  mode: Campaign["mode"]
  brief: CampaignBrief
  schedule: ScheduleInput
  publishMode: Campaign["publishMode"]
  variationIntensity: Campaign["variationIntensity"]
  lockedElements?: string[]
  lockedValues?: Record<string, string>
  modelPrefs?: ModelPrefs
  perRunCapCredits?: number | null
  monthlyCapCredits?: number | null
  youtubeAccountId?: string | null
  visibility?: Campaign["visibility"]
  madeForKids?: boolean
  activate?: boolean
}

export async function createCampaign(db: DbOrTx, c: NewCampaign) {
  const id = newId("campaign")
  const [row] = await db
    .insert(campaigns)
    .values({
      id,
      workspaceId: c.workspaceId,
      createdBy: c.createdBy,
      name: c.name,
      mode: c.mode,
      brief: c.brief,
      status: c.activate ? "active" : "draft",
      publishMode: c.publishMode,
      variationIntensity: c.variationIntensity,
      lockedElements: c.lockedElements ?? [],
      lockedValues: c.lockedValues ?? {},
      modelPrefs: c.modelPrefs ?? {},
      perRunCapCredits: c.perRunCapCredits ?? null,
      monthlyCapCredits: c.monthlyCapCredits ?? null,
      youtubeAccountId: c.youtubeAccountId ?? null,
      visibility: c.visibility ?? "public",
      madeForKids: c.madeForKids ?? false,
    })
    .returning()
  await db.insert(schedules).values({ id: newId("schedule"), workspaceId: c.workspaceId, campaignId: id, ...scheduleColumns(c.schedule) })
  return row!
}

const scheduleColumns = (s: ScheduleInput) => ({
  frequency: s.frequency,
  days: s.frequency === "daily" ? [] : s.days,
  times: s.times,
  timeZone: s.timeZone,
  generateAheadHours: s.generateAheadHours,
})

export async function updateCampaignSchedule(db: DbOrTx, workspaceId: string, campaignId: string, s: ScheduleInput) {
  await db.update(schedules).set(scheduleColumns(s)).where(inWorkspace(schedules, workspaceId, eq(schedules.campaignId, campaignId)))
  // Booked runs that haven't started belong to the old schedule.
  await db
    .update(runs)
    .set({ status: "canceled", finishedAt: new Date(), errorMessage: "Schedule changed." })
    .where(inWorkspace(runs, workspaceId, eq(runs.campaignId, campaignId), eq(runs.status, "planned"), eq(runs.trigger, "schedule")))
}

export async function getCampaign(db: DbOrTx, workspaceId: string, campaignId: string) {
  const [row] = await db
    .select({ campaign: campaigns, schedule: schedules })
    .from(campaigns)
    .innerJoin(schedules, eq(schedules.campaignId, campaigns.id))
    .where(inWorkspace(campaigns, workspaceId, eq(campaigns.id, campaignId)))
  return row ?? null
}

export async function listCampaigns(db: DbOrTx, workspaceId: string) {
  return db
    .select({ campaign: campaigns, schedule: schedules })
    .from(campaigns)
    .innerJoin(schedules, eq(schedules.campaignId, campaigns.id))
    .where(inWorkspace(campaigns, workspaceId))
    .orderBy(desc(campaigns.createdAt))
}

/** Active campaigns with their schedules, for the scheduler. */
export async function activeCampaigns(db: DbOrTx) {
  return db.select({ campaign: campaigns, schedule: schedules }).from(campaigns).innerJoin(schedules, eq(schedules.campaignId, campaigns.id)).where(eq(campaigns.status, "active"))
}

export async function setCampaignActive(db: DbOrTx, workspaceId: string, campaignId: string) {
  await db
    .update(campaigns)
    .set({ status: "active", pauseReason: null, pauseMessage: null, pausedAt: null, consecutiveFailures: 0 })
    .where(inWorkspace(campaigns, workspaceId, eq(campaigns.id, campaignId)))
}

/** Pauses a campaign: by a person ("user") or by the system (budget, credentials, repeated failures). */
export async function pauseCampaign(db: DbOrTx, campaignId: string, reason: PauseReason, message: string | null = null) {
  await db.update(campaigns).set({ status: "paused", pauseReason: reason, pauseMessage: message, pausedAt: new Date() }).where(eq(campaigns.id, campaignId))
}

export async function archiveCampaign(db: DbOrTx, workspaceId: string, campaignId: string) {
  await db.update(campaigns).set({ status: "archived" }).where(inWorkspace(campaigns, workspaceId, eq(campaigns.id, campaignId)))
  await db
    .update(runs)
    .set({ status: "canceled", finishedAt: new Date() })
    .where(inWorkspace(runs, workspaceId, eq(runs.campaignId, campaignId), eq(runs.status, "planned")))
}

/**
 * Books runs for the next `horizon` posting slots. Safe to call every minute: a slot that already has
 * a run (any status, including skipped) is never booked again.
 */
export async function bookUpcomingRuns(db: DbOrTx, c: { campaign: Campaign; schedule: Schedule }, now = new Date(), horizon = 3) {
  const slots = upcomingSlots(
    { frequency: c.schedule.frequency, days: c.schedule.days, times: c.schedule.times, timeZone: c.schedule.timeZone, generateAheadHours: c.schedule.generateAheadHours },
    now,
    horizon
  )
  if (slots.length === 0) return 0
  const inserted = await db
    .insert(runs)
    .values(slots.map((s) => ({ id: newId("run"), workspaceId: c.campaign.workspaceId, campaignId: c.campaign.id, slotAt: s.slotAt, generateAt: s.generateAt })))
    .onConflictDoNothing({ target: [runs.campaignId, runs.slotAt] })
    .returning({ id: runs.id })
  await db.update(campaigns).set({ nextRunAt: slots[0]!.slotAt }).where(eq(campaigns.id, c.campaign.id))
  return inserted.length
}

/** "Skip next run": the earliest planned run is marked skipped (its slot stays taken, so it isn't rebooked). */
export async function skipNextRun(db: DbOrTx, workspaceId: string, campaignId: string) {
  const [next] = await db
    .select()
    .from(runs)
    .where(inWorkspace(runs, workspaceId, eq(runs.campaignId, campaignId), eq(runs.status, "planned")))
    .orderBy(asc(runs.slotAt))
    .limit(1)
  if (!next) return null
  await db
    .update(runs)
    .set({ status: "skipped", version: next.version + 1, finishedAt: new Date(), errorMessage: "Skipped by you." })
    .where(and(eq(runs.id, next.id), eq(runs.status, "planned")))
  return next
}

/** "Run now": books an extra run that starts generating immediately and posts at the next free quarter hour. */
export async function runNow(db: DbOrTx, workspaceId: string, campaignId: string, now = new Date()) {
  const slot = runNowSlot(now)
  const [row] = await db
    .insert(runs)
    .values({ id: newId("run"), workspaceId, campaignId, slotAt: slot.slotAt, generateAt: slot.generateAt, trigger: "run_now", nextCheckAt: now })
    .onConflictDoNothing({ target: [runs.campaignId, runs.slotAt] })
    .returning()
  return row ?? null
}

/** Upcoming and recent runs for the campaign page. */
export async function listRuns(db: DbOrTx, workspaceId: string, campaignId: string, opts: { from?: Date; limit?: number } = {}) {
  return db
    .select()
    .from(runs)
    .where(inWorkspace(runs, workspaceId, eq(runs.campaignId, campaignId), opts.from ? gt(runs.slotAt, opts.from) : undefined))
    .orderBy(desc(runs.slotAt))
    .limit(opts.limit ?? 30)
}

/** How many scene clips each run has finished (a scene counts once, whatever its retries). */
export async function runSceneProgress(db: DbOrTx, runIds: string[]): Promise<Map<string, number>> {
  const done = new Map<string, number>()
  if (runIds.length === 0) return done
  const rows = await db
    .selectDistinct({ runId: generationJobs.runId, sceneIndex: generationJobs.sceneIndex })
    .from(generationJobs)
    .where(and(inArray(generationJobs.runId, runIds), eq(generationJobs.status, "stored")))
  for (const r of rows) if (r.runId) done.set(r.runId, (done.get(r.runId) ?? 0) + 1)
  return done
}

/** The finished video of each run, for thumbnails and links. */
export async function videosForRuns(db: DbOrTx, workspaceId: string, runIds: string[]) {
  if (runIds.length === 0) return new Map<string, { thumbnailKey: string | null; youtubeUrl: string | null }>()
  const rows = await db
    .select({ runId: videos.runId, thumbnailKey: videos.thumbnailKey, youtubeUrl: videos.youtubeUrl })
    .from(videos)
    .where(inWorkspace(videos, workspaceId, inArray(videos.runId, runIds)))
  return new Map(rows.filter((r) => r.runId).map((r) => [r.runId!, { thumbnailKey: r.thumbnailKey, youtubeUrl: r.youtubeUrl }]))
}

export async function cancelPlannedRun(db: DbOrTx, workspaceId: string, runId: string) {
  await db
    .update(runs)
    .set({ status: "skipped", finishedAt: new Date(), errorMessage: "Skipped by you." })
    .where(inWorkspace(runs, workspaceId, eq(runs.id, runId), inArray(runs.status, ["planned"])))
}

/** The workspace's next booked runs across all campaigns (dashboard). */
export async function upcomingRuns(db: DbOrTx, workspaceId: string, limit = 6) {
  return db
    .select({ run: runs, campaignName: campaigns.name, timeZone: schedules.timeZone })
    .from(runs)
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .innerJoin(schedules, eq(schedules.campaignId, campaigns.id))
    .where(inWorkspace(runs, workspaceId, inArray(runs.status, ["planned", "generating", "assembling", "awaiting_approval", "uploading", "scheduled"])))
    .orderBy(asc(runs.slotAt))
    .limit(limit)
}
