import { z } from "zod"
import { isValidTimeZone } from "./youtube"

// Campaigns: set up once, then every scheduled run makes a new variation and posts it.

export const VIDEO_MODES = ["original", "product", "ugc", "clipping"] as const // Phase 1 ships "original"
export type VideoMode = (typeof VIDEO_MODES)[number]

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "archived"] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

/** Why a campaign paused itself (null when a person paused it). */
export const PAUSE_REASONS = ["user", "monthly_cap", "run_cap", "low_balance", "bad_credentials", "youtube_auth", "repeated_failures"] as const
export type PauseReason = (typeof PAUSE_REASONS)[number]

export const PUBLISH_MODES = ["auto", "approval"] as const // spec default: auto-publish
export type PublishMode = (typeof PUBLISH_MODES)[number]

export const VARIATION_INTENSITIES = ["low", "medium", "high"] as const
export type VariationIntensity = (typeof VARIATION_INTENSITIES)[number]

/** Elements a user can lock so every run keeps them. */
// Names match the variation engine's axes (variation.ts). A locked element keeps the value of the first run.
export const LOCKABLE_ELEMENTS = ["voice", "visual_style", "camera_language", "caption_style", "music_mood", "script_angle", "cta"] as const
export type LockableElement = (typeof LOCKABLE_ELEMENTS)[number]

/**
 * One run = one Short for one posting slot.
 *   planned → generating → assembling → [awaiting_approval] → uploading → scheduled → published
 * plus failed, skipped (user skipped it, or budget stopped it) and canceled.
 */
export const RUN_STATUSES = [
  "planned",
  "generating",
  "assembling",
  "awaiting_approval",
  "uploading",
  "scheduled", // uploaded to YouTube as private with publishAt
  "published",
  "failed",
  "skipped",
  "canceled",
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** Video Library tabs. */
export const VIDEO_STATUSES = ["generating", "ready", "scheduled", "published", "failed"] as const
export type VideoStatus = (typeof VIDEO_STATUSES)[number]

// ── Schedules ───────────────────────────────────────────────────────────────

export const FREQUENCIES = ["daily", "weekly", "three_per_week", "custom"] as const
export type Frequency = (typeof FREQUENCIES)[number]

/** 0 = Sunday … 6 = Saturday (same as Date.getDay()). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, for example 18:00")

export const ScheduleSchema = z
  .object({
    frequency: z.enum(FREQUENCIES),
    /** weekly: one day; three_per_week: exactly three; custom: any (with `times` per slot). */
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    times: z.array(time).min(1).max(6), // posting times in `timeZone`; daily may post more than once a day
    timeZone: z.string().refine(isValidTimeZone, "Unknown time zone").default("Asia/Manila"),
    generateAheadHours: z.number().int().min(1).max(72).default(24),
  })
  .superRefine((s, ctx) => {
    const unique = new Set(s.days).size === s.days.length
    if (!unique) ctx.addIssue({ code: "custom", message: "Each day once", path: ["days"] })
    if (s.frequency === "weekly" && s.days.length !== 1) ctx.addIssue({ code: "custom", message: "Pick one day", path: ["days"] })
    if (s.frequency === "three_per_week" && s.days.length !== 3) ctx.addIssue({ code: "custom", message: "Pick three days", path: ["days"] })
    if (s.frequency === "custom" && s.days.length === 0) ctx.addIssue({ code: "custom", message: "Pick at least one day", path: ["days"] })
  })
export type ScheduleInput = z.infer<typeof ScheduleSchema>
