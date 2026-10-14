import { z } from "zod"
import { BrandKitSchema, CAPTION_STYLES, InputAssetSchema, LOOKS, VIDEO_TYPES, VOICES } from "./brief"
import { CHANGE_TARGETS, SHORT_LENGTHS, STAGES, VIDEO_TIERS } from "./credits"

// Vidora ↔ n8n webhook contracts (docs/PLAN.md §4.2–4.3). Both sides validate against these.
// n8n imports nothing from here; infra/n8n/README.md mirrors the shapes for workflow authors.

export const StageSchema = z.enum(STAGES)

export const AssetKindSchema = z.enum([
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
export type AssetKind = z.infer<typeof AssetKindSchema>

export const GenerateRequestSchema = z.object({
  job_id: z.string().startsWith("job_"),
  revision: z.number().int().min(1),
  workspace_id: z.string().startsWith("ws_"),
  rerun_from_stage: StageSchema.nullable(),
  feedback: z
    .object({
      targets: z.array(z.enum(Object.keys(CHANGE_TARGETS) as [keyof typeof CHANGE_TARGETS])),
      text: z.string().max(2000),
    })
    .nullable(),
  strategy: z.object({
    niche: z.string(),
    audience: z.string(),
    tone: z.string(),
    language: z.string().min(2).max(10),
    format: z.enum(["short", "long"]),
    target_length_sec: z.number().int().positive(),
    visual_style: z.enum(["hybrid", "full_ai"]),
  }),
  topic: z.string().nullable(),
  providers: z.object({
    llm: z.string(),
    tts: z.string(),
    video: z.string(),
    image: z.string(),
    tier: z.enum(VIDEO_TIERS),
  }),
  limits: z.object({ max_cost_usd: z.number().positive(), max_clip_seconds: z.number().int().positive() }),
  reuse_assets: z.record(z.string(), z.string()),
  callback_url: z.url(),
  // Create-video wizard choices (optional, so strategy-driven jobs and older payloads still validate).
  // When length_sec is set, strategy.target_length_sec carries the same value.
  video_type: z.enum(VIDEO_TYPES).optional(),
  look: z.enum(LOOKS).optional(),
  voice: z.enum(VOICES).optional(),
  captions_style: z.enum(CAPTION_STYLES).optional(),
  length_sec: z.literal(SHORT_LENGTHS).optional(),
  source_url: z.url().nullable().optional(),
  brand_kit: BrandKitSchema.nullable().optional(),
  input_assets: z.array(InputAssetSchema).max(5).optional(),
})
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>

export const GenerateAcceptedSchema = z.object({ accepted: z.literal(true), execution_id: z.string() })

export const CallbackAssetSchema = z.object({
  kind: AssetKindSchema,
  ordinal: z.number().int().min(0).default(0),
  storage_key: z.string().min(1),
  mime: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  bytes: z.number().int().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const CallbackCostSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  units: z.number().nonnegative(),
  unit: z.string(),
  usd: z.number().nonnegative(),
})

export const CallbackErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  provider: z.string().optional(),
})

export const CallbackTypeSchema = z.enum(["job.stage_started", "job.stage_completed", "job.completed", "job.failed"])

export const CallbackEventSchema = z
  .object({
    event_id: z.string().min(8).max(100),
    type: CallbackTypeSchema,
    job_id: z.string().startsWith("job_"),
    revision: z.number().int().min(1),
    execution_id: z.string(),
    stage: StageSchema.nullable().default(null),
    progress: z.number().min(0).max(1).optional(),
    assets: z.array(CallbackAssetSchema).default([]),
    data: z
      .object({
        script: z.unknown().optional(),
        title: z.string().max(200).optional(),
        caption: z.string().max(5000).optional(),
        hashtags: z.array(z.string().max(100)).max(30).optional(),
      })
      .default({}),
    cost: z.array(CallbackCostSchema).default([]),
    error: CallbackErrorSchema.nullable().default(null),
  })
  .refine((e) => e.type !== "job.failed" || e.error !== null, { message: "job.failed needs an error", path: ["error"] })
export type CallbackEvent = z.infer<typeof CallbackEventSchema>

export const ClaimRequestSchema = z.object({ revision: z.number().int().min(1), execution_id: z.string() })

/** n8n error workflow → Vidora: the execution failed outside the pipeline's own error handling. */
export const ExecutionFailedSchema = z.object({
  message: z.string().max(5000),
  node: z.string().nullable().default(null),
  workflow: z.string().nullable().default(null),
})
