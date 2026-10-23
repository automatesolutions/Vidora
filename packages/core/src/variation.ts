import { createHash } from "node:crypto"
import type { VariationIntensity } from "./campaign"

// The variation engine: decides what changes in each run so no two Shorts look or sound alike.
// Deterministic code picks the "production" choices (style, camera language, pacing, voice, model …);
// the director agent then writes the creative content inside those choices. Every run's choices are
// saved as a fingerprint and compared with earlier runs.

/** Option pools for the axes the engine varies. Campaign settings can replace any pool. */
export const DEFAULT_POOLS = {
  visual_style: [
    // Every style is photorealistic live action from a full-frame cinema camera; the director adds the
    // lens, depth of field and realism locks (prompts.ts).
    "golden-hour rim light from behind the subject, soft bounce fill, natural lens flare, subtle film grain",
    "soft window key light, gentle falloff into shadow, true-to-life skin texture, subtle film grain",
    "moody practical lights (lamps, screens, street light), deep but readable shadows, subtle film grain",
    "overcast soft key outdoors, wet surfaces and fine haze, natural lens flare, subtle film grain",
    "low sun through a doorway or blinds, hard motivated shafts of light, dust in the air, subtle film grain",
    "night exterior with practical neon and sodium street light, wet reflections, anamorphic flares, subtle film grain",
  ],
  color_grade: [
    "teal and orange: teal shadows, warm skin, rich contrast that never crushes the blacks",
    "warm filmic: amber highlights, soft creamy midtones, gentle roll-off, rich contrast without crushed blacks",
    "desaturated moody: muted colors, cool shadows, one warm accent, rich contrast without crushed blacks",
  ],
  camera_language: [
    // Moves only: no static shots. Low angles track at a level horizon (tilts rendered sideways in testing).
    "slow push-in",
    "handheld follow",
    "low-angle tracking shot, camera level",
    "lateral tracking shot",
    "whip pan into the action, then settle",
    "slow dolly out revealing the scene",
  ],
  pacing: ["fast: a new shot or camera change every 1.5-2 s", "brisk: a new shot or camera change every 2-3 s"],
  script_angle: [
    "surprising fact",
    "myth versus truth",
    "short story with a twist",
    "quick how-to in steps",
    "question and answer",
    "countdown list",
    "before and after",
    "common mistake and the fix",
  ],
  caption_style: ["bold pop-on words", "karaoke word highlight", "clean boxed subtitles", "minimal lower third"],
  music_mood: ["uplifting", "calm ambient", "driving electronic", "cinematic swell", "warm acoustic", "lo-fi chill"],
} satisfies Record<string, readonly string[]>

export type VariationAxis = keyof typeof DEFAULT_POOLS | "voice" | "model" | "cta"
export type Variation = Record<string, string>

/** How many unlocked axes change from the previous run. High changes every unlocked axis. */
const AXES_TO_CHANGE: Record<VariationIntensity, number | "all"> = { low: 2, medium: 4, high: "all" }

export type PickInput = {
  pools: Record<string, readonly string[]> // axis → options (voice, model and cta pools come from the campaign)
  locked: Record<string, string> // axis → fixed value
  history: Variation[] // newest first
  intensity: VariationIntensity
  random?: () => number
}

/**
 * Picks this run's variation. Each changed axis takes the option used least recently (ties broken at
 * random), and the whole combination is re-drawn if it matches one of the recent runs.
 */
export function pickVariation(input: PickInput): Variation {
  const random = input.random ?? Math.random
  const axes = Object.keys(input.pools).filter((a) => (input.pools[a]?.length ?? 0) > 0 || a in input.locked)
  const last = input.history[0]
  const recentKeys = new Set(input.history.slice(0, 30).map(combinationKey))

  for (let attempt = 0; attempt < 25; attempt++) {
    const unlocked = axes.filter((a) => !(a in input.locked))
    const changeCount = AXES_TO_CHANGE[input.intensity]
    // Without a previous run everything is new; each failed attempt changes one more axis.
    const n = !last || changeCount === "all" ? unlocked.length : Math.min(unlocked.length, changeCount + attempt)
    const toChange = new Set(shuffle(unlocked, random).slice(0, n))

    const v: Variation = {}
    for (const axis of axes) {
      if (axis in input.locked) v[axis] = input.locked[axis]!
      else if (last && !toChange.has(axis) && last[axis] && input.pools[axis]!.includes(last[axis]!)) v[axis] = last[axis]!
      else v[axis] = leastRecentlyUsed(input.pools[axis]!, axis, input.history, last?.[axis], random)
    }
    if (!recentKeys.has(combinationKey(v))) return v
  }
  // Every combination nearby is taken (tiny pools, many locks): accept a repeat rather than stall.
  const v: Variation = {}
  for (const axis of axes) v[axis] = input.locked[axis] ?? leastRecentlyUsed(input.pools[axis]!, axis, input.history, undefined, random)
  return v
}

function leastRecentlyUsed(options: readonly string[], axis: string, history: Variation[], avoid: string | undefined, random: () => number) {
  const candidates = options.length > 1 && avoid ? options.filter((o) => o !== avoid) : [...options]
  const age = (o: string) => {
    const i = history.findIndex((h) => h[axis] === o)
    return i === -1 ? Number.POSITIVE_INFINITY : i
  }
  const oldest = Math.max(...candidates.map(age))
  const pool = candidates.filter((o) => age(o) === oldest)
  return pool[Math.floor(random() * pool.length)]!
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

const combinationKey = (v: Variation) =>
  Object.keys(v)
    .sort()
    .map((k) => `${k}=${v[k]}`)
    .join("|")

/** Fingerprint of a finished plan: the production choices plus the hook. Stored per run. */
export function variationHash(v: Variation, hook: string): string {
  return createHash("sha256").update(`${combinationKey(v)}#${normalizeText(hook)}`).digest("hex").slice(0, 32)
}

// ── Text similarity (hooks, titles, prompts) ─────────────────────────────────

export function normalizeText(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Word shingles (n-grams). Short texts fall back to single words so they still compare. */
export function shingles(s: string, n = 2): string[] {
  const words = normalizeText(s).split(" ").filter(Boolean)
  if (words.length < n) return words
  const out = new Set<string>()
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "))
  return [...out]
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  return inter / (sa.size + sb.size - inter)
}

/** Most similar earlier text (0..1). Hooks at or above HOOK_SIMILARITY_LIMIT count as reused. */
export function maxSimilarity(text: string, previous: readonly string[]): number {
  const s = shingles(text)
  return previous.reduce((m, p) => Math.max(m, jaccard(s, shingles(p))), 0)
}
export const HOOK_SIMILARITY_LIMIT = 0.45
