import { z } from "zod"
import { SHORT_LENGTHS } from "./credits"

// What a creator picks in the create-video wizard (/app/new). The server validates it again before
// creating the job, and it's stored on video_jobs.brief. Labels live in the web app; these are the keys.

export const CREATOR_KINDS = ["creator", "business", "agency"] as const
export type CreatorKind = (typeof CREATOR_KINDS)[number]

export const VIDEO_TYPES = ["fact_tip", "product_showcase", "photo_to_life", "quote"] as const
export type VideoType = (typeof VIDEO_TYPES)[number]

export const LOOKS = ["realistic", "cinematic", "cartoon_3d", "anime", "clean_minimal"] as const
export type Look = (typeof LOOKS)[number]

export const VOICES = ["calm", "energetic", "deep", "friendly", "music_only"] as const
export type Voice = (typeof VOICES)[number]

export const VOICE_LANGUAGES = ["en", "es", "pt", "fr", "de"] as const
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]

export const CAPTION_STYLES = ["bold_words", "simple", "none"] as const
export type CaptionStyle = (typeof CAPTION_STYLES)[number]

export const TOPIC_MAX = 300
export const END_CARD_TEXT_MAX = 60
export const BRAND_COLORS_MAX = 3

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color, like #FF4F00")

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .max(2000)
  .refine((u) => !/^https?:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u), "Use a public website link")

/** Brand kit as the pipeline sees it: storage keys, never URLs or bytes (n8n never handles files). */
export const BrandKitSchema = z.object({
  logo_key: z.string().min(1).nullable(),
  colors: z.array(hexColor).max(BRAND_COLORS_MAX),
  end_card_text: z.string().trim().max(END_CARD_TEXT_MAX).nullable(),
})
export type BrandKit = z.infer<typeof BrandKitSchema>

export const InputAssetSchema = z.object({
  kind: z.enum(["photo"]),
  storage_key: z.string().min(1),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
})
export type InputAsset = z.infer<typeof InputAssetSchema>

export const VideoBriefSchema = z
  .object({
    creator_kind: z.enum(CREATOR_KINDS),
    video_type: z.enum(VIDEO_TYPES),
    topic: z.string().trim().max(TOPIC_MAX).nullable(),
    source_url: httpUrl.nullable(),
    photo_upload_id: z.string().startsWith("upl_").nullable(),
    // "Bring a photo to life" is for photos without people until the likeness consent flow exists.
    no_people_confirmed: z.boolean(),
    look: z.enum(LOOKS),
    voice: z.enum(VOICES),
    language: z.enum(VOICE_LANGUAGES),
    captions_style: z.enum(CAPTION_STYLES),
    length_sec: z.literal(SHORT_LENGTHS),
    use_brand_kit: z.boolean(),
  })
  .superRefine((b, ctx) => {
    const need = (path: keyof typeof b, message: string) => ctx.addIssue({ code: "custom", path: [path], message })
    if ((b.video_type === "fact_tip" || b.video_type === "quote") && (b.topic ?? "").length < 3) {
      need("topic", "Add a topic of at least 3 characters")
    }
    if (b.video_type === "product_showcase" && !b.source_url && !b.photo_upload_id) {
      need("source_url", "Add a product or website link, or a photo")
    }
    if (b.video_type === "photo_to_life") {
      if (!b.photo_upload_id) need("photo_upload_id", "Add a photo")
      if (!b.no_people_confirmed) need("no_people_confirmed", "Confirm the photo has no people in it")
    }
  })
export type VideoBrief = z.infer<typeof VideoBriefSchema>
