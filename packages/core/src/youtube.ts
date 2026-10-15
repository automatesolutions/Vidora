import { z } from "zod"

// YouTube Shorts rules Vidora applies before an upload. Pure functions, shared by the review page and the worker.

export const YT_TITLE_MAX = 100
export const YT_DESCRIPTION_MAX = 5000
// YouTube ignores every hashtag on a video that has more than 15.
export const YT_HASHTAGS_MAX = 15
export const SHORTS_TAG = "#Shorts"

export const VISIBILITIES = ["public", "unlisted", "private"] as const
export type Visibility = (typeof VISIBILITIES)[number]

/** Cleans hashtags: one leading #, letters/digits/underscore only, no duplicates, #Shorts always first. */
export function normalizeHashtags(tags: readonly string[]): string[] {
  const seen = new Set<string>([SHORTS_TAG.toLowerCase()])
  const out = [SHORTS_TAG]
  for (const raw of tags) {
    const body = raw.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")
    if (!body) continue
    const tag = `#${body}`
    if (seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    out.push(tag)
    if (out.length === YT_HASHTAGS_MAX) break
  }
  return out
}

/** Description as uploaded: the creator's text, then the hashtags, within YouTube's limit. */
export function buildDescription(description: string, hashtags: readonly string[]): string {
  const tags = normalizeHashtags(hashtags).join(" ")
  const room = YT_DESCRIPTION_MAX - tags.length - 2
  const text = description.trim().slice(0, Math.max(0, room)).trim()
  return text ? `${text}\n\n${tags}` : tags
}

export const ReviewDetailsSchema = z.object({
  title: z.string().trim().min(1, "Add a title").max(YT_TITLE_MAX, `Keep the title under ${YT_TITLE_MAX + 1} characters`),
  description: z.string().max(YT_DESCRIPTION_MAX - 200),
  hashtags: z.array(z.string().max(100)).max(30),
  visibility: z.enum(VISIBILITIES),
  madeForKids: z.boolean(),
  coverOrdinal: z.number().int().min(0).max(20),
})
export type ReviewDetails = z.infer<typeof ReviewDetailsSchema>

/**
 * The `status` part of a videos.insert request. Until Google's API audit passes, YouTube locks every upload
 * from Vidora's project to private, so we ask for private up front instead of pretending. The AI label is
 * always on: every Vidora video is synthetic media.
 */
export function youtubeUploadStatus(input: { visibility: Visibility; audited: boolean; madeForKids: boolean }) {
  return {
    privacyStatus: input.audited ? input.visibility : ("private" as Visibility),
    selfDeclaredMadeForKids: input.madeForKids,
    containsSyntheticMedia: true as const,
  }
}

// ── Time zones (no library: Intl only) ──────────────────────────────────────

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") }
}

/** The UTC instant of a wall-clock time in `timeZone`. Handles DST by correcting the offset twice. */
export function zonedTimeToUtc(local: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string): Date {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  let guess = asUtc
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone)
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    guess += asUtc - shown
  }
  return new Date(guess)
}

/**
 * Suggested post time: the next 6:00 PM in the creator's time zone that is at least an hour away
 * (evening is the usual Shorts peak). Later this reads the strategy's posting windows.
 */
export function suggestPostTime(timeZone: string, now = new Date(), hour = 18): Date {
  const today = zonedParts(now, timeZone)
  for (let addDays = 0; addDays < 3; addDays++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + addDays))
    const at = zonedTimeToUtc({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour, minute: 0 }, timeZone)
    if (at.getTime() - now.getTime() >= 60 * 60_000) return at
  }
  throw new Error("unreachable")
}

/** "Tue 6:00 PM" in the creator's time zone, for "Approve for {day time}". */
export function formatPostTime(date: Date, timeZone: string): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" })
  const parts = f.formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("weekday")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}
