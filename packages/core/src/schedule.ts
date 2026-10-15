import type { ScheduleInput } from "./campaign"
import { zonedTimeToUtc } from "./youtube"

// Turns a campaign schedule into concrete posting slots (UTC instants) and the time each run should
// start generating. Pure and time-zone aware (Intl only), so DST shifts land on the right local time.

export type ScheduleRule = Pick<ScheduleInput, "frequency" | "days" | "times" | "timeZone" | "generateAheadHours">

export type Slot = { slotAt: Date; generateAt: Date }

function localDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday }
}

/** Days of the week this rule posts on (0 = Sunday). Daily posts every day. */
function postingDays(rule: ScheduleRule): Set<number> {
  return rule.frequency === "daily" ? new Set([0, 1, 2, 3, 4, 5, 6]) : new Set(rule.days)
}

/**
 * The next `count` posting slots strictly after `after`, in order. A slot whose generate time has
 * already passed is still returned (the scheduler decides whether there's time left to make it).
 */
export function upcomingSlots(rule: ScheduleRule, after: Date, count: number): Slot[] {
  const days = postingDays(rule)
  const times = [...new Set(rule.times)].sort()
  if (days.size === 0 || times.length === 0 || count <= 0) return []
  const out: Slot[] = []
  const start = localDate(after, rule.timeZone)
  // Walk local calendar days; 400 days covers any weekly rule many times over.
  for (let offset = 0; offset < 400 && out.length < count; offset++) {
    const d = new Date(Date.UTC(start.year, start.month - 1, start.day + offset))
    if (!days.has(d.getUTCDay())) continue
    for (const t of times) {
      const [hour, minute] = t.split(":").map(Number) as [number, number]
      const slotAt = zonedTimeToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute }, rule.timeZone)
      if (slotAt <= after) continue
      out.push({ slotAt, generateAt: new Date(slotAt.getTime() - rule.generateAheadHours * 3_600_000) })
      if (out.length === count) break
    }
  }
  return out
}

/** A run must start at least this long before its slot to be worth making (renders + upload). */
export const MIN_LEAD_MINUTES = 45

/** "Run now" posts at the next whole quarter hour that leaves MIN_LEAD_MINUTES to make the video. */
export function runNowSlot(now = new Date()): Slot {
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60_000
  const quarter = 15 * 60_000
  const slotAt = new Date(Math.ceil(earliest / quarter) * quarter)
  return { slotAt, generateAt: now }
}

/** "Mon, Wed, Fri at 6:00 PM" style summary for the campaign list. */
export function describeSchedule(rule: ScheduleRule): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const times = [...rule.times].sort().map((t) => {
    const [h, m] = t.split(":").map(Number) as [number, number]
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
  })
  const days = rule.frequency === "daily" ? "Every day" : [...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => names[d]).join(", ")
  return `${days} at ${times.join(" and ")}`
}
