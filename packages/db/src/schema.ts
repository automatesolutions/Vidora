// AutoShorts Studio database schema. Keys are camelCase; columns become snake_case via `casing`.
// Rule: every tenant table has `workspaceId`, and every query filters on it (see `scoped.ts`).
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import {
  CAMPAIGN_STATUSES,
  FREQUENCIES,
  GENERATION_STATUSES,
  PAUSE_REASONS,
  PUBLISH_MODES,
  RUN_STATUSES,
  VARIATION_INTENSITIES,
  VIDEO_MODES,
  VIDEO_STATUSES,
  VISIBILITIES,
  type ModelInputSchema,
} from "@vidora/core"

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
const ts = () => timestamp({ withTimezone: true })
const usd = () => numeric({ precision: 12, scale: 4, mode: "number" })
const credits = () => numeric({ precision: 14, scale: 3, mode: "number" })
const textArray = () => text().array().notNull().default(sql`'{}'::text[]`)

// ── Enums ────────────────────────────────────────────────────────────────────
export const memberRole = pgEnum("member_role", ["owner", "admin", "editor", "viewer"])
export const platform = pgEnum("platform", ["youtube"])
export const accountStatus = pgEnum("account_status", ["active", "needs_reauth", "revoked"])
// higgsfield: developer API key (prepaid API credits). higgsfield_mcp: "Connect Higgsfield" sign-in (plan credits).
export const providerName = pgEnum("provider_name", ["higgsfield", "higgsfield_mcp"])
export const credentialStatus = pgEnum("credential_status", ["unverified", "valid", "invalid"])
export const videoMode = pgEnum("video_mode", VIDEO_MODES)
export const campaignStatus = pgEnum("campaign_status", CAMPAIGN_STATUSES)
export const pauseReason = pgEnum("pause_reason", PAUSE_REASONS)
export const publishMode = pgEnum("publish_mode", PUBLISH_MODES)
export const variationIntensity = pgEnum("variation_intensity", VARIATION_INTENSITIES)
export const frequency = pgEnum("frequency", FREQUENCIES)
export const runStatus = pgEnum("run_status", RUN_STATUSES)
export const runTrigger = pgEnum("run_trigger", ["schedule", "run_now"])
export const generationStatus = pgEnum("generation_status", GENERATION_STATUSES)
export const videoStatus = pgEnum("video_status", VIDEO_STATUSES)
export const visibility = pgEnum("visibility", VISIBILITIES)
export const assetKind = pgEnum("asset_kind", [
  "script",
  "scene_clip",
  "voiceover",
  "music",
  "captions",
  "thumbnail",
  "final_video",
  "input_image",
])
export const spendKind = pgEnum("spend_kind", ["hold", "release", "charge"])
export const actorType = pgEnum("actor_type", ["user", "system", "provider"])
export const uploadStatus = pgEnum("upload_status", ["pending", "ready", "rejected"])
export const uploadPurpose = pgEnum("upload_purpose", ["input", "logo", "music"])

// ── Better Auth core tables ──────────────────────────────────────────────────
export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: ts().notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeWorkspaceId: text(), // organization plugin: activeOrganizationId
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)]
)

// Login accounts (email/password, Google sign-in). Not the YouTube channels we post to.
export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: ts(),
    refreshTokenExpiresAt: ts(),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)]
)

export const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: ts().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// ── Workspaces ───────────────────────────────────────────────────────────────
// Better Auth's organization plugin uses these two tables as `organization` and `member`
// (packages/db/src/auth-adapter.ts maps the names). Columns it doesn't know have defaults.
export type WorkspaceSettings = {
  notifyEmail?: boolean // failure and pause emails (default on)
  telegramChatId?: string | null
  lowBalanceCredits?: number // pause campaigns before the Higgsfield balance drops below this
}

export const workspaces = pgTable("workspaces", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(), // organization plugin
  metadata: text(), // organization plugin (JSON string)
  timezone: text().notNull().default("Asia/Manila"),
  settings: jsonb().$type<WorkspaceSettings>().notNull().default({}),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole().notNull().default("editor"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.userId), index().on(t.userId)]
)

// Organization plugin invitations. Team workspaces ship in Phase 3; the table exists so the plugin works.
export const invitation = pgTable(
  "invitation",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text(),
    status: text().notNull().default("pending"),
    expiresAt: ts().notNull(),
    inviterId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId), index().on(t.email)]
)

// ── Connections ──────────────────────────────────────────────────────────────

// The user's Higgsfield API key ("<key id>:<secret>"), AES-256-GCM encrypted. Never sent to the browser.
export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: providerName().notNull(),
    secretEnc: text().notNull(),
    tokenKeyVersion: integer().notNull().default(1),
    keyHint: text().notNull(), // last 4 characters of the key, or the account plan for a sign-in connection
    accountPlan: text(), // higgsfield_mcp: the Higgsfield plan reported at sign-in ("plus")
    status: credentialStatus().notNull().default("unverified"),
    lastVerifiedAt: ts(),
    lastError: text(),
    // Higgsfield's API has no balance endpoint, so the balance is what the user last entered,
    // minus what we've been charged since (see spend_ledger).
    balanceCredits: credits(),
    balanceUpdatedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.provider)]
)

// YouTube channels we post to. Tokens are AES-256-GCM ciphertext.
export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: platform().notNull().default("youtube"),
    externalId: text().notNull(), // channel ID
    displayName: text().notNull(),
    handle: text(),
    avatarUrl: text(),
    scopes: textArray(),
    accessTokenEnc: text().notNull(),
    refreshTokenEnc: text(),
    tokenKeyVersion: integer().notNull().default(1),
    accessExpiresAt: ts(),
    refreshExpiresAt: ts(),
    status: accountStatus().notNull().default("active"),
    dailyUploadCap: integer().notNull().default(3), // compliance: avoid spammy volume per channel
    platformMeta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    lastRefreshedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.platform, t.externalId), index().on(t.status, t.accessExpiresAt)]
)

// Small app-wide settings, e.g. our OAuth client registration with Higgsfield (per redirect URL).
export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, unknown>>().notNull(),
  updatedAt: updatedAt(),
})

// ── Model registry (global, refreshed from docs.higgsfield.ai) ──────────────
export type CostSample = { credits: number; usd: number; at: string }

export const modelRegistry = pgTable(
  "model_registry",
  {
    id: text().primaryKey(), // the endpoint ID, e.g. "kling-video/v3.0/std/text-to-video"
    provider: providerName().notNull().default("higgsfield"),
    family: text().notNull(), // "kling-3"
    displayName: text().notNull(), // "Kling 3.0 — Standard · Text to video"
    workflow: text().notNull(), // "text-to-video", "image-to-video", "text-to-image", ...
    outputKind: text().notNull(), // "video" | "image" | "audio"
    inputSchema: jsonb().$type<ModelInputSchema>().notNull(),
    durations: integer().array().notNull().default(sql`'{}'::integer[]`),
    aspectRatios: textArray(),
    resolutions: textArray(),
    supportsSeed: boolean().notNull().default(false),
    needsImage: boolean().notNull().default(false),
    verticalFromText: boolean().notNull().default(false), // can make 9:16 from a prompt alone
    docsUrl: text().notNull(),
    // Estimates from POST /estimate/<endpoint>, keyed "duration|resolution". Used before every run.
    costSamples: jsonb().$type<Record<string, CostSample>>().notNull().default({}),
    timeoutSec: integer().notNull().default(1800),
    enabled: boolean().notNull().default(true),
    refreshedAt: ts().notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workflow, t.enabled)]
)

// ── Campaigns ────────────────────────────────────────────────────────────────
export type CampaignBrief = {
  topic: string // "daily motivation", a niche, or a full prompt
  audience?: string
  tone?: string
  language?: string // default "en"
  targetLengthSec?: number // ≤ 60
  cta?: string[] // CTA wording options
  hashtagSeeds?: string[]
  bannedTopics?: string[]
  /** Product mode: what is being shown. Photos are upload IDs (uploads table, purpose "input"). */
  product?: { name: string; description?: string; price?: string; link?: string; imageUploadIds: string[] }
}
export type ModelPrefs = {
  /** Endpoint IDs this campaign may use. Empty = the recommended set for the mode. */
  allowed?: string[]
  resolution?: "480p" | "720p" | "1080p"
}

export const campaigns = pgTable(
  "campaigns",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text().notNull(),
    mode: videoMode().notNull().default("original"),
    status: campaignStatus().notNull().default("draft"),
    pauseReason: pauseReason(),
    pauseMessage: text(),
    pausedAt: ts(),
    publishMode: publishMode().notNull().default("auto"),
    youtubeAccountId: text().references(() => connectedAccounts.id, { onDelete: "set null" }),
    brief: jsonb().$type<CampaignBrief>().notNull(),
    modelPrefs: jsonb().$type<ModelPrefs>().notNull().default({}),
    variationIntensity: variationIntensity().notNull().default("medium"),
    lockedElements: textArray(),
    lockedValues: jsonb().$type<Record<string, string>>().notNull().default({}),
    perRunCapUsd: usd(),
    monthlyCapUsd: usd(),
    // Plan credits (Connect Higgsfield) have no dollar price, so caps are kept in credits too.
    perRunCapCredits: credits(),
    monthlyCapCredits: credits(),
    visibility: visibility().notNull().default("public"), // what it becomes at publishAt
    madeForKids: boolean().notNull().default(false),
    nextRunAt: ts(), // denormalized next posting slot, for the dashboard
    lastRunAt: ts(),
    consecutiveFailures: integer().notNull().default(0),
    createdBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.workspaceId, t.status), index().on(t.status, t.nextRunAt)]
)

export const schedules = pgTable("schedules", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  campaignId: text()
    .notNull()
    .unique()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  frequency: frequency().notNull(),
  days: integer().array().notNull().default(sql`'{}'::integer[]`), // 0 = Sunday
  times: textArray(), // "HH:MM" in timeZone
  timeZone: text().notNull().default("Asia/Manila"),
  generateAheadHours: integer().notNull().default(24),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// ── Runs ─────────────────────────────────────────────────────────────────────
/** The director agent's plan for one run, plus what the worker added (model, uploaded photo refs). */
export type RunPlan = {
  concept: string
  hook: string
  subject_anchor: string
  narrator?: { gender: "female" | "male"; age: "young" | "middle_aged" | "old" }
  scenes: { purpose: string; duration_sec: number; voiceover_line: string; prompt: string; negative_prompt: string; caption_words: string }[]
  voiceover_script: string
  title: string
  description: string
  hashtags: string[]
  cta_line: string
  thumbnail_scene_index: number
  modelId: string
  photoRefs?: string[]
  warnings?: string[]
}

export const runs = pgTable(
  "runs",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    slotAt: ts().notNull(), // when the Short goes public (YouTube publishAt)
    generateAt: ts().notNull(), // when work starts (slot minus generateAheadHours)
    trigger: runTrigger().notNull().default("schedule"),
    status: runStatus().notNull().default("planned"),
    version: integer().notNull().default(0), // optimistic lock, +1 on every status change
    plan: jsonb().$type<RunPlan>(),
    variation: jsonb().$type<Record<string, string>>(), // the chosen value of each varied element
    estimateUsd: usd(),
    estimateCredits: credits(),
    nextCheckAt: ts(), // when the worker should look at this run again (resumable, like generation jobs)
    stepAttempts: integer().notNull().default(0),
    errorCode: text(),
    errorMessage: text(),
    startedAt: ts(),
    finishedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.campaignId, t.slotAt), // one run per slot, so the scheduler can't double-book
    index().on(t.status, t.generateAt),
    index().on(t.status, t.nextCheckAt),
    index().on(t.workspaceId, t.slotAt),
  ]
)

export const runEvents = pgTable(
  "run_events",
  {
    id: text().primaryKey(),
    workspaceId: text().notNull(),
    runId: text()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    event: text().notNull(),
    fromStatus: runStatus(),
    toStatus: runStatus(),
    actorType: actorType().notNull(),
    actorId: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.runId, t.createdAt)]
)

// ── Generation jobs (one paid provider request each; resumable) ─────────────
export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text().references(() => runs.id, { onDelete: "cascade" }),
    // Null once the user removes their key; in-flight jobs then stop with bad_credentials.
    credentialId: text().references(() => providerCredentials.id, { onDelete: "set null" }),
    provider: providerName().notNull().default("higgsfield"),
    modelId: text().notNull(),
    sceneIndex: integer().notNull().default(0),
    attempt: integer().notNull().default(1), // 1 = first try; retries are new rows with retryOfId
    retryOfId: text(),
    moderationRetries: integer().notNull().default(0),
    status: generationStatus().notNull().default("pending"),
    version: integer().notNull().default(0),
    // Chosen before the first submit and never changed: re-submitting after a crash returns the same
    // provider request instead of paying for a second one.
    idempotencyKey: text().notNull().unique(),
    input: jsonb().$type<Record<string, unknown>>().notNull(),
    requestId: text().unique(),
    statusUrl: text(),
    cancelUrl: text(),
    providerStatus: text(),
    outputUrl: text(),
    outputKind: text(), // "video" | "image" | "audio"
    storageKey: text(),
    bytes: bigint({ mode: "number" }),
    sha256: text(),
    estimateCredits: credits(),
    estimateUsd: usd(),
    errorKind: text(),
    errorMessage: text(),
    correlationId: text(), // Higgsfield X-Correlation-ID, for support
    submitAttempts: integer().notNull().default(0),
    pollCount: integer().notNull().default(0),
    nextCheckAt: ts(), // when the worker should look at this row again
    submittedAt: ts(),
    completedAt: ts(),
    storedAt: ts(),
    deadlineAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.status, t.nextCheckAt), index().on(t.runId), index().on(t.workspaceId, t.createdAt)]
)

// ── Videos and assets ────────────────────────────────────────────────────────
export const videos = pgTable(
  "videos",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    runId: text()
      .notNull()
      .unique()
      .references(() => runs.id, { onDelete: "cascade" }),
    status: videoStatus().notNull().default("generating"),
    storageKey: text(),
    thumbnailKey: text(),
    durationMs: integer(),
    width: integer(),
    height: integer(),
    bytes: bigint({ mode: "number" }),
    title: text(),
    description: text(),
    tags: textArray(),
    youtubeAccountId: text().references(() => connectedAccounts.id, { onDelete: "set null" }),
    youtubeVideoId: text(),
    youtubeUrl: text(),
    publishAt: ts(),
    publishedAt: ts(),
    approvedBy: text().references(() => user.id, { onDelete: "set null" }),
    approvedAt: ts(),
    costUsd: usd().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.workspaceId, t.status, t.createdAt), index().on(t.campaignId)]
)

// What made a run different. `hash` blocks exact repeats; `hookShingles` feeds the similarity check.
export const variationFingerprints = pgTable(
  "variation_fingerprints",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    runId: text()
      .notNull()
      .unique()
      .references(() => runs.id, { onDelete: "cascade" }),
    elements: jsonb().$type<Record<string, string>>().notNull(),
    hash: text().notNull(),
    hook: text().notNull(),
    hookShingles: textArray(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.campaignId, t.hash)]
)

export const assets = pgTable(
  "assets",
  {
    id: text().primaryKey(),
    workspaceId: text().notNull(),
    runId: text()
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    generationJobId: text().references(() => generationJobs.id, { onDelete: "set null" }),
    kind: assetKind().notNull(),
    ordinal: integer().notNull().default(0),
    storageKey: text().notNull(),
    mime: text().notNull(),
    bytes: bigint({ mode: "number" }),
    durationMs: integer(),
    width: integer(),
    height: integer(),
    sha256: text(),
    provider: text(),
    model: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.runId, t.kind, t.ordinal)]
)

// Files a user uploads (logo, product photos, music). Browser → storage with a signed PUT.
export const uploads = pgTable(
  "uploads",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    purpose: uploadPurpose().notNull(),
    storageKey: text().notNull().unique(),
    mime: text().notNull(),
    bytes: integer().notNull(),
    status: uploadStatus().notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt)]
)

export const brandKits = pgTable("brand_kits", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  logoUploadId: text().references(() => uploads.id, { onDelete: "set null" }),
  colors: textArray(),
  fontFamily: text(),
  captionStyle: text(),
  ctaText: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// ── YouTube uploads and quota ────────────────────────────────────────────────
export const uploadLogs = pgTable(
  "upload_logs",
  {
    id: text().primaryKey(),
    workspaceId: text().notNull(),
    videoId: text()
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    accountId: text().references(() => connectedAccounts.id, { onDelete: "set null" }),
    step: text().notNull(), // "insert" | "thumbnail" | "refresh_token"
    ok: boolean().notNull(),
    httpStatus: integer(),
    quotaUnits: integer().notNull().default(0),
    youtubeVideoId: text(),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.videoId), index().on(t.accountId, t.createdAt)]
)

// YouTube Data API quota is per Google Cloud project and resets at midnight Pacific time.
export const youtubeQuotaDays = pgTable("youtube_quota_days", {
  day: date().primaryKey(), // Pacific date
  unitsUsed: integer().notNull().default(0),
  updatedAt: updatedAt(),
})

// ── Spend ────────────────────────────────────────────────────────────────────
// Append-only. hold = estimate reserved at submit; at the end either charge + release (stored) or
// release only (failed / nsfw / canceled: Higgsfield doesn't bill those). One row per kind per job.
export const spendLedger = pgTable(
  "spend_ledger",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text().references(() => campaigns.id, { onDelete: "set null" }),
    runId: text().references(() => runs.id, { onDelete: "set null" }),
    generationJobId: text().references(() => generationJobs.id, { onDelete: "set null" }),
    kind: spendKind().notNull(),
    usd: usd().notNull(),
    credits: credits().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex().on(t.generationJobId, t.kind),
    index().on(t.workspaceId, t.createdAt),
    index().on(t.campaignId, t.createdAt),
  ]
)

export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    videoId: text()
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    capturedAt: ts().notNull(),
    views: bigint({ mode: "number" }).notNull().default(0),
    likes: bigint({ mode: "number" }).notNull().default(0),
    comments: bigint({ mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.videoId, t.capturedAt] })]
)

// ── Webhooks and notifications ───────────────────────────────────────────────
export const webhookEvents = pgTable("webhook_events", {
  eventId: text().primaryKey(), // higgsfield: "<request_id>:<status>"
  source: text().notNull(),
  receivedAt: ts().notNull().defaultNow(),
  processedAt: ts(),
  outcome: text(),
})

export const notifications = pgTable(
  "notifications",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    readAt: ts(),
    emailedAt: ts(),
    telegramAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt), index().on(t.userId, t.readAt)]
)

export type Workspace = typeof workspaces.$inferSelect
export type ConnectedAccount = typeof connectedAccounts.$inferSelect
export type ProviderCredential = typeof providerCredentials.$inferSelect
export type ModelRegistryRow = typeof modelRegistry.$inferSelect
export type Campaign = typeof campaigns.$inferSelect
export type Schedule = typeof schedules.$inferSelect
export type Run = typeof runs.$inferSelect
export type GenerationJob = typeof generationJobs.$inferSelect
export type Video = typeof videos.$inferSelect
export type Upload = typeof uploads.$inferSelect
export type BrandKitRow = typeof brandKits.$inferSelect
