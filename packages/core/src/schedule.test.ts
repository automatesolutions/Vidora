import { describe, expect, it } from "vitest"
import { describeSchedule, runNowSlot, upcomingSlots } from "./schedule"

const manila = { timeZone: "Asia/Manila", generateAheadHours: 24 }

describe("schedule slots", () => {
  it("3x per week posts Mon/Wed/Fri at 6 PM Manila (10:00 UTC) and generates 24 h before", () => {
    // Wed 2026-10-14 12:00 Manila = 04:00 UTC
    const slots = upcomingSlots({ ...manila, frequency: "three_per_week", days: [1, 3, 5], times: ["18:00"] }, new Date("2026-10-14T04:00:00Z"), 4)
    expect(slots.map((s) => s.slotAt.toISOString())).toEqual([
      "2026-10-14T10:00:00.000Z", // Wed (later today)
      "2026-10-16T10:00:00.000Z", // Fri
      "2026-10-19T10:00:00.000Z", // Mon
      "2026-10-21T10:00:00.000Z", // Wed
    ])
    expect(slots[1]!.generateAt.toISOString()).toBe("2026-10-15T10:00:00.000Z")
  })

  it("daily with two times, skipping times already passed today", () => {
    const slots = upcomingSlots({ ...manila, frequency: "daily", days: [], times: ["18:00", "08:30"] }, new Date("2026-10-14T04:00:00Z"), 3)
    expect(slots.map((s) => s.slotAt.toISOString())).toEqual(["2026-10-14T10:00:00.000Z", "2026-10-15T00:30:00.000Z", "2026-10-15T10:00:00.000Z"])
  })

  it("weekly on Sunday", () => {
    const slots = upcomingSlots({ ...manila, frequency: "weekly", days: [0], times: ["09:00"] }, new Date("2026-10-14T04:00:00Z"), 2)
    expect(slots.map((s) => s.slotAt.toISOString())).toEqual(["2026-10-18T01:00:00.000Z", "2026-10-25T01:00:00.000Z"])
  })

  it("keeps local time across a DST change (New York, Nov 1 2026)", () => {
    const slots = upcomingSlots({ frequency: "daily", days: [], times: ["18:00"], timeZone: "America/New_York", generateAheadHours: 12 }, new Date("2026-10-31T12:00:00Z"), 2)
    expect(slots.map((s) => s.slotAt.toISOString())).toEqual(["2026-10-31T22:00:00.000Z", "2026-11-01T23:00:00.000Z"])
  })

  it("run now posts at the next quarter hour at least 45 minutes out", () => {
    expect(runNowSlot(new Date("2026-10-14T04:07:00Z")).slotAt.toISOString()).toBe("2026-10-14T05:00:00.000Z")
  })

  it("describes a schedule for people", () => {
    expect(describeSchedule({ ...manila, frequency: "three_per_week", days: [5, 1, 3], times: ["18:00"] })).toBe("Mon, Wed, Fri at 6:00 PM")
    expect(describeSchedule({ ...manila, frequency: "daily", days: [], times: ["08:30", "18:00"] })).toBe("Every day at 8:30 AM and 6:00 PM")
  })
})
