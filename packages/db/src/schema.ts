// Vidora database schema (docs/PLAN.md §5). Keys are camelCase; columns become snake_case via `casing`.
// Rule: every tenant table has `workspaceId`, and every query filters on it (see `scoped.ts`).
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { CREATOR_KINDS, JOB_STATUSES, POST_STATUSES, STAGES, VIDEO_TIERS, VIDEO_TYPES, VISIBILITIES, type VideoBrief } from "@vidora/core"

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

// ── Enums ────────────────────────────────────────────────────────────────────
export const jobStatus = pgEnum("job_status", JOB_STATUSES)
export const postStatus = pgEnum("post_status", POST_STATUSES)
export const stage = pgEnum("stage", STAGES)
export const videoTier = pgEnum("video_tier", VIDEO_TIERS)
export const platform = pgEnum("platform", ["youtube", "tiktok"])
export const memberRole = pgEnum("member_role", ["owner", "admin", "reviewer", "viewer"])
export const accountStatus = pgEnum("account_status", ["active", "needs_reauth", "revoked"])
export const videoFormat = pgEnum("video_format", ["short", "long"])
export const visualStyle = pgEnum("visual_style", ["hybrid", "full_ai"])
export const assetKind = pgEnum("asset_kind", [
  "script",
  "voiceover",
  "visual_plan",
  "clip",
  "image",
  "captions_vtt",
  "thumbnail",
  "final_video",
  "preview",
])
export const decision = pgEnum("decision", ["approved", "rejected", "changes_requested"])
export const actorType = pgEnum("actor_type", ["user", "system", "n8n"])
export const planId = pgEnum("plan_id", ["trial", "creator", "pro", "studio"])
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
])
export const ledgerReason = pgEnum("ledger_reason", ["grant", "topup", "reserve", "release", "charge", "refund", "expire"])
export const webhookSource = pgEnum("webhook_source", ["n8n", "stripe"])
export const creatorKind = pgEnum("creator_kind", CREATOR_KINDS)
export const videoType = pgEnum("video_type", VIDEO_TYPES)
export const visibility = pgEnum("visibility", VISIBILITIES)
export const uploadStatus = pgEnum("upload_status", ["pending", "ready", "rejected"])
export const uploadPurpose = pgEnum("upload_purpose", ["input", "logo"])

// ── Better Auth core tables ──────────────────────────────────────────────────
// Default Better Auth model names. In Phase 1, diff against `npx @better-auth/cli generate` before migrating.
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
    expiresAt: timestamp({ withTimezone: true }).notNull(),
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

// Login accounts (email/password, Google sign-in). Not the YouTube/TikTok posting accounts.
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
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
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
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// ── Workspaces ───────────────────────────────────────────────────────────────
// Better Auth's organization plugin uses these two tables as `organization` and `member`
// (packages/db/src/auth-adapter.ts maps the names). Columns it doesn't know have defaults.
export const workspaces = pgTable("workspaces", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(), // organization plugin
  metadata: text(), // organization plugin (JSON string)
  timezone: text().notNull().default("UTC"),
  plan: planId().notNull().default("trial"),
  kind: creatorKind(), // "Who are you?" in the create-video wizard, asked once
  freeVideoUsedAt: timestamp({ withTimezone: true }), // set when the first (free) video is created
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
    role: memberRole().notNull().default("reviewer"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.userId), index().on(t.userId)]
)

// Organization plugin invitations. Team invites ship in Phase 2; the table exists so the plugin works.
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
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    inviterId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId), index().on(t.email)]
)

// YouTube / TikTok accounts Vidora posts to. Tokens are AES-256-GCM ciphertext (see docs/PLAN.md §9).
export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: platform().notNull(),
    externalId: text().notNull(),
    displayName: text().notNull(),
    handle: text(),
    avatarUrl: text(),
    scopes: text().array().notNull().default(sql`'{}'::text[]`),
    accessTokenEnc: text().notNull(),
    refreshTokenEnc: text(),
    tokenKeyVersion: integer().notNull().default(1),
    accessExpiresAt: timestamp({ withTimezone: true }),
    refreshExpiresAt: timestamp({ withTimezone: true }),
    status: accountStatus().notNull().default("active"),
    platformMeta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    lastRefreshedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.workspaceId, t.platform, t.externalId),
    index().on(t.status, t.accessExpiresAt), // token refresh sweep
  ]
)

export const contentStrategies = pgTable(
  "content_strategies",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text().notNull(),
    niche: text().notNull(),
    audience: text().notNull(),
    tone: text().notNull(),
    voiceId: text(),
    language: text().notNull().default("en"),
    format: videoFormat().notNull().default("short"),
    targetLengthSec: integer().notNull().default(45),
    visualStyle: visualStyle().notNull().default("hybrid"),
    tier: videoTier().notNull().default("short_standard"),
    cadence: text().notNull(), // RRULE, e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR
    postingWindows: jsonb().$type<{ day: number; start: string; end: string }[]>().notNull().default([]),
    targetAccountIds: text().array().notNull().default(sql`'{}'::text[]`),
    bannedTopics: text().array().notNull().default(sql`'{}'::text[]`),
    hashtagSeeds: text().array().notNull().default(sql`'{}'::text[]`),
    aiDisclosure: boolean().notNull().default(true),
    generateAheadDays: integer().notNull().default(3),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.workspaceId)]
)

// ── Video jobs ───────────────────────────────────────────────────────────────
export const videoJobs = pgTable(
  "video_jobs",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    strategyId: text().references(() => contentStrategies.id, { onDelete: "set null" }),
    status: jobStatus().notNull().default("queued"),
    revision: integer().notNull().default(1),
    version: integer().notNull().default(0), // optimistic lock, +1 on every status change
    tier: videoTier().notNull().default("short_standard"),
    topic: text(),
    // Wizard choices (VideoBriefSchema). Empty for strategy-driven jobs.
    brief: jsonb().$type<Partial<VideoBrief>>().notNull().default({}),
    videoType: videoType(),
    lengthSec: integer(),
    creditsBase: integer().notNull().default(0), // list price; change requests are priced from it
    isFree: boolean().notNull().default(false), // the workspace's free first video
    brandKitSnapshot: jsonb().$type<Record<string, unknown>>(), // brand kit as it was when the job was made
    script: jsonb(),
    title: text(),
    caption: text(), // the YouTube description, editable on the review page
    hashtags: text().array().notNull().default(sql`'{}'::text[]`),
    // Review page choices, copied onto scheduled_posts when the video is approved.
    visibility: visibility().notNull().default("public"),
    madeForKids: boolean().notNull().default(false),
    coverOrdinal: integer().notNull().default(0), // which `thumbnail` asset (frame candidate) is the cover
    plannedPostAt: timestamp({ withTimezone: true }),
    currentStage: stage(),
    progress: real().notNull().default(0),
    rerunFromStage: stage(),
    feedback: jsonb().$type<{ targets: string[]; text: string }>(),
    providerProfile: jsonb().$type<Record<string, string>>().notNull().default({}),
    n8nExecutionId: text(),
    dispatchedAt: timestamp({ withTimezone: true }),
    dispatchAttempts: integer().notNull().default(0),
    changeRequestCount: integer().notNull().default(0),
    creditsReserved: integer().notNull().default(0),
    creditsCharged: integer().notNull().default(0),
    costUsd: numeric({ precision: 10, scale: 4, mode: "number" }).notNull().default(0),
    errorCode: text(),
    errorMessage: text(),
    lastEventAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.workspaceId, t.status),
    index().on(t.status, t.lastEventAt), // dispatcher + stuck-job reconciler
  ]
)

export const jobEvents = pgTable(
  "job_events",
  {
    id: text().primaryKey(),
    workspaceId: text().notNull(),
    jobId: text()
      .notNull()
      .references(() => videoJobs.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
    event: text().notNull(),
    fromStatus: jobStatus(),
    toStatus: jobStatus(),
    actorType: actorType().notNull(),
    actorId: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.jobId, t.createdAt)]
)

export const assets = pgTable(
  "assets",
  {
    id: text().primaryKey(),
    workspaceId: text().notNull(),
    jobId: text()
      .notNull()
      .references(() => videoJobs.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
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
  (t) => [uniqueIndex().on(t.jobId, t.revision, t.kind, t.ordinal)]
)

export const approvals = pgTable(
  "approvals",
  {
    id: text().primaryKey(),
    workspaceId: text().notNull(),
    jobId: text()
      .notNull()
      .references(() => videoJobs.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
    reviewerId: text().references(() => user.id, { onDelete: "set null" }),
    decision: decision().notNull(),
    changeTargets: text().array().notNull().default(sql`'{}'::text[]`),
    feedback: text(),
    creditsCost: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.jobId)]
)

export const scheduledPosts = pgTable(
  "scheduled_posts",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: text()
      .notNull()
      .references(() => videoJobs.id, { onDelete: "cascade" }),
    connectedAccountId: text()
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    platform: platform().notNull(),
    scheduledAt: timestamp({ withTimezone: true }).notNull(),
    status: postStatus().notNull().default("scheduled"),
    title: text(),
    caption: text(),
    hashtags: text().array().notNull().default(sql`'{}'::text[]`),
    // TikTok: privacy level, comments/duet/stitch, disclosure. YouTube: visibility, made for kids, synthetic media.
    platformOptions: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    attemptCount: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }),
    idempotencyKey: text().notNull().unique(),
    externalPostId: text(),
    externalUrl: text(),
    lastError: text(),
    publishedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.status, t.scheduledAt), index().on(t.workspaceId, t.scheduledAt), index().on(t.jobId)]
)

export const postMetrics = pgTable(
  "post_metrics",
  {
    postId: text()
      .notNull()
      .references(() => scheduledPosts.id, { onDelete: "cascade" }),
    capturedAt: timestamp({ withTimezone: true }).notNull(),
    views: bigint({ mode: "number" }).notNull().default(0),
    likes: bigint({ mode: "number" }).notNull().default(0),
    comments: bigint({ mode: "number" }).notNull().default(0),
    shares: bigint({ mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.capturedAt] })]
)

// ── Billing and usage ────────────────────────────────────────────────────────
export const subscriptions = pgTable("subscriptions", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  stripeCustomerId: text().notNull(),
  stripeSubscriptionId: text().unique(),
  plan: planId().notNull(),
  status: subscriptionStatus().notNull(),
  periodStart: timestamp({ withTimezone: true }),
  periodEnd: timestamp({ withTimezone: true }),
  cancelAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// Append-only. The newest row per workspace holds the balance after it.
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    reason: ledgerReason().notNull(),
    credits: integer().notNull(),
    availableAfter: integer().notNull(),
    reservedAfter: integer().notNull(),
    jobId: text().references(() => videoJobs.id, { onDelete: "set null" }),
    stripeRef: text(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt)]
)

export const providerRuns = pgTable(
  "provider_runs",
  {
    id: text().primaryKey(),
    workspaceId: text().notNull(),
    jobId: text()
      .notNull()
      .references(() => videoJobs.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
    stage: stage(),
    provider: text().notNull(),
    model: text(),
    units: real().notNull(),
    unit: text().notNull(),
    costUsd: numeric({ precision: 10, scale: 4, mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.jobId), index().on(t.workspaceId, t.createdAt)]
)

export const webhookEvents = pgTable("webhook_events", {
  eventId: text().primaryKey(),
  source: webhookSource().notNull(),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp({ withTimezone: true }),
  outcome: text(),
})

export const notifications = pgTable(
  "notifications",
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp({ withTimezone: true }),
    emailedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.readAt)]
)

// Files a creator uploads before a job exists (wizard photo, brand kit logo). Browser → R2 with a signed PUT,
// then /api/uploads/[id]/complete checks the size and file type and marks it ready.
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

// One brand kit per workspace for now. GENERATION.md G3 adds brand_kit_assets (characters, products, LUT).
export const brandKits = pgTable("brand_kits", {
  id: text().primaryKey(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  logoUploadId: text().references(() => uploads.id, { onDelete: "set null" }),
  colors: text().array().notNull().default(sql`'{}'::text[]`),
  endCardText: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export type VideoJob = typeof videoJobs.$inferSelect
export type Workspace = typeof workspaces.$inferSelect
export type ConnectedAccount = typeof connectedAccounts.$inferSelect
export type Upload = typeof uploads.$inferSelect
export type BrandKitRow = typeof brandKits.$inferSelect
