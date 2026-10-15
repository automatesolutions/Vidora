// Integration tests against a real Postgres. Run with TEST_DATABASE_URL set (compose `dev` profile).
import { newId } from "@vidora/core"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { bookUpcomingRuns, createCampaign, getCampaign, pauseCampaign, runNow, setCampaignActive, skipNextRun } from "./campaigns"
import { createDb, type Db } from "./client"
import { dueRuns, recentVariations, saveFingerprint, stepRun } from "./runs"
import { runs, workspaces } from "./schema"

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

suite("campaigns and runs (Postgres)", () => {
  let db: Db
  let workspaceId: string

  beforeAll(async () => {
    db = createDb(url, { max: 4 })
    workspaceId = newId("workspace")
    await db.insert(workspaces).values({ id: workspaceId, name: "Campaign test", slug: workspaceId.toLowerCase() })
  })
  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    await db.close()
  })

  const make = (activate = true) =>
    createCampaign(db, {
      workspaceId,
      createdBy: null,
      name: "Budget tips",
      mode: "original",
      brief: { topic: "Easy budget tips for young Filipinos" },
      schedule: { frequency: "three_per_week", days: [1, 3, 5], times: ["18:00"], timeZone: "Asia/Manila", generateAheadHours: 24 },
      publishMode: "auto",
      variationIntensity: "medium",
      activate,
    })

  it("books the next slots once, however often the scheduler runs", async () => {
    const c = await make()
    const full = (await getCampaign(db, workspaceId, c.id))!
    const now = new Date("2026-10-14T04:00:00Z") // Wed noon Manila
    expect(await bookUpcomingRuns(db, full, now, 3)).toBe(3)
    expect(await bookUpcomingRuns(db, full, now, 3)).toBe(0)
    expect(await bookUpcomingRuns(db, full, new Date("2026-10-14T04:05:00Z"), 3)).toBe(0)
    const booked = await db.select().from(runs).where(eq(runs.campaignId, c.id))
    expect(booked.map((r) => r.slotAt.toISOString()).sort()).toEqual(["2026-10-14T10:00:00.000Z", "2026-10-16T10:00:00.000Z", "2026-10-19T10:00:00.000Z"])
    expect((await getCampaign(db, workspaceId, c.id))!.campaign.nextRunAt!.toISOString()).toBe("2026-10-14T10:00:00.000Z")
  })

  it("skips the next run without rebooking its slot", async () => {
    const c = await make()
    const full = (await getCampaign(db, workspaceId, c.id))!
    const now = new Date("2026-10-14T04:00:00Z")
    await bookUpcomingRuns(db, full, now, 2)
    const skipped = await skipNextRun(db, workspaceId, c.id)
    expect(skipped!.slotAt.toISOString()).toBe("2026-10-14T10:00:00.000Z")
    expect(await bookUpcomingRuns(db, full, now, 2)).toBe(0)
    const [row] = await db.select().from(runs).where(eq(runs.id, skipped!.id))
    expect(row!.status).toBe("skipped")
  })

  it("starts only due runs of active campaigns, plus run-now runs of paused ones", async () => {
    const active = await make()
    const paused = await make()
    const now = new Date("2026-10-15T11:00:00Z") // after Fri's generate time (Thu 10:00 UTC)
    await bookUpcomingRuns(db, (await getCampaign(db, workspaceId, active.id))!, new Date("2026-10-14T11:00:00Z"), 2)
    await bookUpcomingRuns(db, (await getCampaign(db, workspaceId, paused.id))!, new Date("2026-10-14T11:00:00Z"), 2)
    await pauseCampaign(db, paused.id, "user")
    const extra = await runNow(db, workspaceId, paused.id, now)
    const due = (await dueRuns(db, now, 500)).filter((r) => [active.id, paused.id].includes(r.campaignId))
    expect(due.filter((r) => r.campaignId === active.id).map((r) => r.slotAt.toISOString())).toEqual(["2026-10-16T10:00:00.000Z"])
    expect(due.filter((r) => r.campaignId === paused.id).map((r) => r.id)).toEqual([extra!.id])
    await setCampaignActive(db, workspaceId, paused.id)
  })

  it("advances a run once even if two workers race", async () => {
    const c = await make()
    await bookUpcomingRuns(db, (await getCampaign(db, workspaceId, c.id))!, new Date("2026-10-14T04:00:00Z"), 1)
    const [run] = await db.select().from(runs).where(eq(runs.campaignId, c.id))
    const first = await stepRun(db, run!, { status: "generating", startedAt: new Date() }, { name: "started" })
    const second = await stepRun(db, run!, { status: "generating", startedAt: new Date() }, { name: "started" })
    expect(first?.status).toBe("generating")
    expect(second).toBeNull()
  })

  it("refuses a repeated fingerprint and returns recent variations newest first", async () => {
    const c = await make()
    await bookUpcomingRuns(db, (await getCampaign(db, workspaceId, c.id))!, new Date("2026-10-14T04:00:00Z"), 2)
    const [a, b] = await db.select().from(runs).where(eq(runs.campaignId, c.id))
    const v = { visual_style: "warm", camera_language: "push-in" }
    expect(await saveFingerprint(db, a!, v, "Save twenty percent first")).toBe(true)
    expect(await saveFingerprint(db, b!, v, "save twenty percent FIRST!")).toBe(false) // same hash
    expect(await saveFingerprint(db, b!, { ...v, camera_language: "dolly out" }, "save twenty percent first")).toBe(true)
    expect((await recentVariations(db, c.id))[0]).toEqual({ ...v, camera_language: "dolly out" })
  })
})
