// Voiceover with ElevenLabs directly (ELEVENLABS_API_KEY), never through a Higgsfield plan: the
// Higgsfield API has no speech models, and plan credits must not be spent. eleven_v3 reads audio tags
// like "[excited]" for a more human delivery; eleven_multilingual_v2 (no tags) is the fallback. When
// both fail, the Short is made without narration and the reason is logged.

/** The line without audio tags: what's actually heard, and what captions show. */
export function stripTags(line: string) {
  return line.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim()
}

/** Tags for plans written before the director added its own (`voiceover_performance`). */
const DEFAULT_DELIVERY: Record<string, string> = { hook: "[excited]", build: "[curious]", payoff: "[confident]", cta: "[warm]" }

/** The line to send to ElevenLabs v3: the director's tagged version when it matches the script, else a tag by purpose. */
export function performanceLine(scene: { purpose: string; voiceover_line: string; voiceover_performance?: string }) {
  const tagged = scene.voiceover_performance?.trim()
  const same = (a: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
  if (tagged && same(stripTags(tagged)) === same(scene.voiceover_line)) return tagged
  return `${DEFAULT_DELIVERY[scene.purpose] ?? ""} ${scene.voiceover_line}`.trim()
}

/** ElevenLabs premade voices the variation engine rotates through unless the campaign locks one. */
export const DEFAULT_VOICES = [
  "JBFqnCBsd6RMkjVDRZzb", // George: warm, steady
  "21m00Tcm4TlvDq8ikWAM", // Rachel: calm, clear
  "EXAVITQu4vr4xnSDxMaL", // Sarah: soft, friendly
  "TX3LPaxmHKxFdv7VOQHJ", // Liam: energetic
  "XB0fDUnXU5powFXDhCwa", // Charlotte: bright
]

export type Narrator = { gender: "female" | "male"; age: "young" | "middle_aged" | "old" }

/** ElevenLabs premade voices by who they sound like, American accents first (checked 2026-10-18). */
const VOICES: (Narrator & { id: string; american: boolean })[] = [
  { id: "EXAVITQu4vr4xnSDxMaL", gender: "female", age: "young", american: true }, // Sarah
  { id: "FGY2WhTYpPnrIDTdsKH5", gender: "female", age: "young", american: true }, // Laura
  { id: "cgSgspJ2msm6clMCkdW9", gender: "female", age: "young", american: true }, // Jessica
  { id: "21m00Tcm4TlvDq8ikWAM", gender: "female", age: "young", american: true }, // Rachel
  { id: "XrExE9yKIg1WjnnlVkGX", gender: "female", age: "middle_aged", american: true }, // Matilda
  { id: "9BWtsMINqrJLrRacOk9x", gender: "female", age: "middle_aged", american: true }, // Aria
  { id: "pFZP5JQG7iQjIQuC4Bku", gender: "female", age: "middle_aged", american: false }, // Lily
  { id: "Xb7hH8MSUJpSbSDYk0k2", gender: "female", age: "middle_aged", american: false }, // Alice
  { id: "TX3LPaxmHKxFdv7VOQHJ", gender: "male", age: "young", american: true }, // Liam
  { id: "bIHbv24MWmeRgasZH58o", gender: "male", age: "young", american: true }, // Will
  { id: "cjVigY5qzO86Huf0OWal", gender: "male", age: "middle_aged", american: true }, // Eric
  { id: "iP95p4xoKVk53GoZ742B", gender: "male", age: "middle_aged", american: true }, // Chris
  { id: "nPczCjzI2devNBz1zQrb", gender: "male", age: "middle_aged", american: true }, // Brian
  { id: "JBFqnCBsd6RMkjVDRZzb", gender: "male", age: "middle_aged", american: false }, // George
  { id: "pqHfZKP75CvOlQylNhV4", gender: "male", age: "old", american: true }, // Bill
]
const AGES: Narrator["age"][] = ["young", "middle_aged", "old"]

/** A voice that sounds like the plan's narrator: same gender, nearest age, American first. `seed` rotates among equals. */
export function pickVoice(narrator: Narrator | undefined, seed: string): string | undefined {
  if (!narrator) return undefined
  const gap = (v: Narrator) => Math.abs(AGES.indexOf(v.age) - AGES.indexOf(narrator.age))
  const same = VOICES.filter((v) => v.gender === narrator.gender)
  const best = Math.min(...same.map(gap))
  const near = same.filter((v) => gap(v) === best)
  const pool = near.some((v) => v.american) ? near.filter((v) => v.american) : near
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return pool[h % pool.length]?.id
}

export type VoiceResult = { ok: true; audio: Uint8Array } | { ok: false; error: string }

/** A tagged line in eleven_v3 (it acts out the tags); if that fails, the plain line in eleven_multilingual_v2. */
export async function speakExpressive(taggedLine: string, voiceId: string, opts: { apiKey?: string; fetch?: typeof fetch } = {}): Promise<VoiceResult> {
  const v3 = await speak(taggedLine, voiceId, { ...opts, modelId: "eleven_v3" })
  if (v3.ok) return v3
  const v2 = await speak(stripTags(taggedLine), voiceId, opts)
  return v2.ok ? v2 : v3
}

export async function speak(text: string, voiceId: string, opts: { apiKey?: string; fetch?: typeof fetch; modelId?: string } = {}): Promise<VoiceResult> {
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY
  if (!apiKey) return { ok: false, error: "No ELEVENLABS_API_KEY set." }
  const f = opts.fetch ?? fetch
  try {
    const res = await f(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: opts.modelId ?? "eleven_multilingual_v2" }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      const message = /"message":\s*"([^"]+)"/.exec(body)?.[1] ?? `HTTP ${res.status}`
      return { ok: false, error: `ElevenLabs: ${message}` }
    }
    return { ok: true, audio: new Uint8Array(await res.arrayBuffer()) }
  } catch (err) {
    return { ok: false, error: `ElevenLabs unreachable: ${(err as Error).message}` }
  }
}

export type WordTime = { text: string; start: number; end: number }

/**
 * When each word of `script` is spoken in `audio`, for word-by-word captions. Uses ElevenLabs
 * speech-to-text (Scribe) for real timings; without a key, or if it fails, spreads the words over
 * the clip by their length. Caption text always comes from the script, not the transcript.
 */
export async function wordTimings(audio: Uint8Array, script: string, seconds: number, opts: { apiKey?: string; fetch?: typeof fetch } = {}): Promise<WordTime[]> {
  const words = stripTags(script).split(" ").filter(Boolean)
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY
  if (apiKey && words.length) {
    try {
      const form = new FormData()
      form.append("model_id", "scribe_v1")
      form.append("file", new Blob([audio as BlobPart], { type: "audio/mpeg" }), "line.mp3")
      const res = await (opts.fetch ?? fetch)("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) {
        const body = (await res.json()) as { words?: { text: string; start: number; end: number; type?: string }[] }
        const heard = (body.words ?? []).filter((w) => (w.type ?? "word") === "word")
        if (heard.length) return alignWords(words, heard)
      }
    } catch {
      // fall through to the estimate
    }
  }
  return estimateWords(words, seconds)
}

/** Script words onto transcript timings, in order. Counts usually match; when they don't, stretch by position. */
export function alignWords(words: string[], heard: { start: number; end: number }[]): WordTime[] {
  return words.map((text, i) => {
    const j = words.length === heard.length ? i : Math.min(heard.length - 1, Math.floor((i * heard.length) / words.length))
    const h = heard[j]!
    return { text, start: h.start, end: Math.max(h.end, h.start + 0.08) }
  })
}

/** Even spread weighted by word length, with a short lead-in and tail. */
export function estimateWords(words: string[], seconds: number): WordTime[] {
  const lead = 0.1
  const span = Math.max(0.5, seconds - lead - 0.25)
  const weights = words.map((w) => w.length + 2)
  const total = weights.reduce((a, b) => a + b, 0)
  let t = lead
  return words.map((text, i) => {
    const d = (weights[i]! / total) * span
    const w = { text, start: t, end: t + d }
    t += d
    return w
  })
}
