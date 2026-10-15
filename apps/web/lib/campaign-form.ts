import { LOCKABLE_ELEMENTS, PUBLISH_MODES, ScheduleSchema, VARIATION_INTENSITIES } from "@vidora/core/campaign"
import { VISIBILITIES } from "@vidora/core/youtube"
import { z } from "zod"

// The new-campaign form: validated in the browser for quick feedback and again in the server action.
const text = (max: number) => z.string().trim().max(max)

export const NewCampaignSchema = z
  .object({
    name: text(80).min(1, "Name the campaign"),
    mode: z.enum(["original", "product"]),
    topic: text(1500),
    audience: text(200).optional(),
    tone: text(120).optional(),
    language: z.enum(["en", "fil", "es", "pt", "fr", "de"]).default("en"),
    targetLengthSec: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(59)]).default(30),
    cta: z.array(text(120)).max(5).default([]),
    hashtagSeeds: z.array(text(40)).max(10).default([]),
    bannedTopics: z.array(text(60)).max(10).default([]),
    product: z
      .object({
        name: text(120).min(1, "Add the product name"),
        description: text(1000).optional(),
        price: text(40).optional(),
        link: z.url("Use a full link, like https://shop.example.com/item").max(500).optional().or(z.literal("")),
        imageUploadIds: z.array(z.string()).min(1, "Add at least one product photo").max(6),
      })
      .optional(),
    schedule: ScheduleSchema,
    publishMode: z.enum(PUBLISH_MODES),
    variationIntensity: z.enum(VARIATION_INTENSITIES),
    lockedElements: z.array(z.enum(LOCKABLE_ELEMENTS)).default([]),
    perRunCapCredits: z.number().positive().max(10_000).nullable().default(null),
    monthlyCapCredits: z.number().positive().max(1_000_000).nullable().default(null),
    youtubeAccountId: z.string().nullable().default(null),
    visibility: z.enum(VISIBILITIES).default("public"),
    madeForKids: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    if (c.mode === "original" && c.topic.length < 3) ctx.addIssue({ code: "custom", path: ["topic"], message: "Describe what the videos are about" })
    if (c.mode === "product" && !c.product) ctx.addIssue({ code: "custom", path: ["product"], message: "Add the product details" })
  })
export type NewCampaignInput = z.input<typeof NewCampaignSchema>

