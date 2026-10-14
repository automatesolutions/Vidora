import type { CaptionStyle, CreatorKind, Look, VideoType, Voice, VoiceLanguage } from "@vidora/core/brief"
import { SHORT_CREDIT_COST } from "@vidora/core/credits"
import type { Visibility } from "@vidora/core/youtube"

// User-facing names for the create-video choices. Keys come from packages/core/src/brief.ts.
// Copy rules: .claude/skills/vidora-design/SKILL.md §7 (checked by `pnpm copy-lint`).

type Choice = { label: string; description: string }

export const CREATOR_KIND_LABELS: Record<CreatorKind, Choice> = {
  creator: { label: "Creator", description: "You post to your own channel." },
  business: { label: "Business", description: "You promote your product or service." },
  agency: { label: "Agency", description: "You make videos for clients." },
}

export const VIDEO_TYPE_LABELS: Record<VideoType, Choice> = {
  fact_tip: { label: "Fact or tip", description: "One surprising fact or useful tip, told in seconds." },
  product_showcase: { label: "Product showcase", description: "Show a product from its website or a photo." },
  photo_to_life: { label: "Bring a photo to life", description: "Add motion to a photo of a place, product, or pet." },
  quote: { label: "Quote or motivation", description: "A short quote with visuals and a voice that fit it." },
}

export const LOOK_LABELS: Record<Look, Choice> = {
  realistic: { label: "Realistic", description: "Looks like real footage." },
  cinematic: { label: "Cinematic", description: "Film lighting and slow camera moves." },
  cartoon_3d: { label: "3D cartoon", description: "Rounded, colorful 3D scenes." },
  anime: { label: "Anime", description: "Hand-drawn anime style." },
  clean_minimal: { label: "Clean minimal", description: "Simple shapes and plenty of space." },
}

export const VOICE_LABELS: Record<Voice, Choice> = {
  calm: { label: "Calm", description: "Slow and steady." },
  energetic: { label: "Energetic", description: "Fast and upbeat." },
  deep: { label: "Deep", description: "Low and warm." },
  friendly: { label: "Friendly", description: "Like talking to a friend." },
  music_only: { label: "Music only", description: "No voice. Music and captions." },
}

export const LANGUAGE_LABELS: Record<VoiceLanguage, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
}

export const CAPTION_LABELS: Record<CaptionStyle, Choice> = {
  bold_words: { label: "Bold word by word", description: "Each word lights up as it's spoken." },
  simple: { label: "Simple", description: "Plain lines at the bottom." },
  none: { label: "None", description: "No captions on the video." },
}

export const LENGTH_LABELS: Record<8 | 15, Choice> = {
  8: { label: "8 seconds", description: `${SHORT_CREDIT_COST[8]} credits` },
  15: { label: "15 seconds", description: `${SHORT_CREDIT_COST[15]} credits` },
}

export const VISIBILITY_LABELS: Record<Visibility, Choice> = {
  public: { label: "Public", description: "Anyone can find and watch it." },
  unlisted: { label: "Unlisted", description: "Only people with the link can watch it." },
  private: { label: "Private", description: "Only you can watch it." },
}

export function creditsLabel(n: number) {
  return `${n} ${n === 1 ? "credit" : "credits"}`
}
