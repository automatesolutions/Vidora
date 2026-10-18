// Voiceover with ElevenLabs text-to-speech. Optional: when it fails (no key, unpaid invoice), the
// Short is made without narration and the reason is logged on the run.

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
