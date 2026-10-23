import type { Variation } from "@vidora/core"

// Everything the director knows about one run, and how it's shown to Claude. The system prompt is
// fixed (and cached); this per-run context goes in the user message as tagged sections.

export type DirectorBrief = {
  campaignName: string
  mode: "original" | "product" | "ugc" | "clipping"
  topic: string // the campaign description: a niche, a topic, or a full prompt
  audience?: string
  tone?: string
  language?: string // BCP 47, default "en"
  targetLengthSec?: number // default 30, max 59
  ctaOptions?: string[]
  hashtagSeeds?: string[]
  bannedTopics?: string[]
  /** Product mode: scene i starts from product photo (i mod photoCount) as its first frame. */
  product?: { name: string; description?: string; price?: string; link?: string; photoCount: number }
}

export type DirectorModel = {
  id: string
  displayName: string
  durations: number[] // allowed seconds per generation
  promptMaxChars: number | null
  supportsNegativePrompt: boolean
}

export type DirectorHistory = {
  hooks: string[] // newest first
  titles: string[]
  concepts: string[]
}

export type DirectorInput = {
  brief: DirectorBrief
  brand?: { colors?: string[]; ctaText?: string | null }
  variation: Variation // from pickVariation: visual_style, camera_language, pacing, script_angle, ...
  model: DirectorModel
  history: DirectorHistory
  /** The posting date in the campaign's time zone, e.g. "Friday, 16 October 2026". Lets the plan be timely. */
  postDate: string
}

export const DEFAULTS = { language: "en", targetLengthSec: 30, maxLengthSec: 59, promptMaxChars: 2500 }

/** Shot length for fast pacing: a new shot every few seconds (validate.ts warns outside it). */
export const SHOT_SECONDS = { min: 3, max: 5, hookMax: 4 }

/** Words per second a narrator speaks comfortably, by language (falls back to English). */
export const SPEECH_RATE: Record<string, number> = { en: 2.5, es: 2.7, pt: 2.6, fr: 2.6, de: 2.2, fil: 2.4, tl: 2.4 }

export function targetSeconds(brief: DirectorBrief) {
  return Math.min(Math.max(brief.targetLengthSec ?? DEFAULTS.targetLengthSec, 10), DEFAULTS.maxLengthSec)
}

/** The prompt length we ask for: long enough for every labeled section (prompts.ts), inside the model's hard limit. */
export function promptBudget(model: DirectorModel) {
  const hard = model.promptMaxChars ?? DEFAULTS.promptMaxChars
  const target = Math.min(3500, Math.round(hard * 0.88))
  // Models without a negative prompt get the AVOID line inside the prompt, so scenes get that much less.
  const avoid = model.supportsNegativePrompt ? 0 : AVOID_LINE.length + 1
  return { min: Math.min(900, Math.round(hard * 0.4)), target, scene: Math.max(400, target - LOOK_CHARS - avoid), max: hard }
}

/** Always in the negative prompt (models that take one), whatever the plan says. */
export const BASE_NEGATIVE = [
  // The creator's list (2026-10-23)
  "phone screen visible, mobile screen content, scrolling, swiping, fast thumb movement, app UI, unreadable or gibberish text, fake logos, glitching screen, flickering display",
  "robotic movement, stiff posture, jerky motion, unnatural gestures, floating or sliding body, morphing face, distorted hands, extra fingers, warped fingers, blurry face, plastic skin",
  "uncanny eyes, frozen expression, duplicated limbs, sudden camera jumps, watermark, subtitles, text overlay",
  // Earlier locks
  "static shot, slow intro, fade in, blurry, low resolution, distorted face, deformed hands, warped text, on-screen text, logo, cartoonish, 3D render, CGI, inconsistent character, flicker, talking, lip movement, phone screen facing camera, readable phone screen",
].join(", ")

/**
 * For models without a negative prompt (Kling 3.0 on the API), appended to every prompt: the items
 * the positive OUTPUT line doesn't already cover, kept short because it shares the prompt limit.
 */
export const AVOID_LINE =
  "AVOID: phone screen visible, scrolling or swiping, app UI, gibberish text, fake logos, subtitles, watermark, robotic or jerky motion, floating body, morphing face, warped or extra fingers, uncanny eyes, frozen expression, sudden camera jumps."

/** About how long the shared look is once appended to each scene (validate.ts assemble). */
export const LOOK_CHARS = 1320

const esc = (s: string) => s.replace(/</g, "‹").replace(/>/g, "›") // keep user text from closing our tags

function list(items: readonly string[] | undefined) {
  return items && items.length ? items.map((i) => `- ${esc(i)}`).join("\n") : "(none)"
}

export function renderContext(input: DirectorInput): string {
  const b = input.brief
  const v = input.variation
  const seconds = targetSeconds(b)
  const lang = b.language ?? DEFAULTS.language
  const words = Math.round(seconds * (SPEECH_RATE[lang.split("-")[0]!] ?? SPEECH_RATE.en!))
  const budget = promptBudget(input.model)

  return `<campaign>
Name: ${esc(input.brief.campaignName)}
Mode: ${b.mode}
Description from the creator (this is what every video is about):
${esc(b.topic)}
Audience: ${esc(b.audience ?? "general YouTube Shorts viewers")}
Tone: ${esc(b.tone ?? "friendly, confident, clear")}
Narration language: ${lang}
Posting date: ${esc(input.postDate)}
</campaign>

<format>
Vertical 9:16 YouTube Short, about ${seconds} seconds (scene durations must add up to ${seconds - 3}-${Math.min(seconds + 5, DEFAULTS.maxLengthSec)} s).
Fast pacing: shots of ${SHOT_SECONDS.min}-${SHOT_SECONDS.max} s each, about ${Math.round(seconds / 4)} scenes. Hook, escalation, payoff, call to action.
Narration budget: about ${words} words in total (${lang}).
Captions, the on-screen hook text, voiceover, music and the call to action are added by our editor after generation, so prompts describe pictures only.
</format>

<this_run>
These production choices were picked for this run so it differs from earlier videos. Use them exactly.
Script angle: ${esc(v.script_angle ?? "your choice")}
Visual style: ${esc(v.visual_style ?? "your choice")}
Color grade: ${esc(v.color_grade ?? "warm filmic: amber highlights, soft creamy midtones, rich contrast without crushed blacks")}
Camera language (the dominant move; vary framing around it): ${esc(v.camera_language ?? "your choice")}
Pacing: ${esc(v.pacing ?? "brisk: a new shot or camera change every 2-3 s")}
Music mood (for your pacing only, never in prompts): ${esc(v.music_mood ?? "n/a")}
</this_run>

<video_model>
Higgsfield model: ${esc(input.model.displayName)} (${esc(input.model.id)})
Allowed scene durations in seconds: ${input.model.durations.join(", ") || "5"}
Prompt length: each scene prompt about ${budget.scene} characters, and the whole look about ${LOOK_CHARS}; together they must stay under ${budget.max}.
Negative prompt: ${input.model.supportsNegativePrompt ? "supported, fill it in" : "not supported, leave it empty"}
Every scene is a separate generation: the model remembers nothing between scenes.
</video_model>

<brand>
Colors: ${input.brand?.colors?.length ? input.brand.colors.map(esc).join(", ") : "(none set)"}
Call to action options:
${list(input.brief.ctaOptions?.length ? input.brief.ctaOptions : input.brand?.ctaText ? [input.brand.ctaText] : ["Follow for more"])}
Hashtag ideas: ${input.brief.hashtagSeeds?.length ? input.brief.hashtagSeeds.map(esc).join(", ") : "(none)"}
Never mention or show: ${input.brief.bannedTopics?.length ? input.brief.bannedTopics.map(esc).join(", ") : "(nothing extra)"}
</brand>
${renderProduct(b)}
<recent_videos>
Hooks already used (do not reuse or paraphrase closely):
${list(input.history.hooks.slice(0, 25))}
Titles already used:
${list(input.history.titles.slice(0, 15))}
Concepts already covered:
${list(input.history.concepts.slice(0, 15))}
</recent_videos>`
}

function renderProduct(b: DirectorBrief) {
  const p = b.product
  if (!p) return ""
  const lines = [
    "<product>",
    "This is a Product video. Show this product; it must look exactly as in the creator's photos.",
    `Name: ${esc(p.name)}`,
    p.description ? `Description: ${esc(p.description)}` : null,
    p.price ? `Price: ${esc(p.price)}` : null,
    p.link ? "Buy link: it goes in the YouTube description; the CTA should point to it." : null,
    `Photos: ${p.photoCount}. Scene 1 starts from photo 1, scene 2 from photo ${Math.min(2, p.photoCount)}, and so on, wrapping around.`,
    "</product>",
  ]
  return `\n${lines.filter((l) => l !== null).join("\n")}\n`
}
