import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

// Music beds and sound effects from ElevenLabs (sound generation and music APIs), made once and
// cached: every Short reuses them, so they cost nothing after the first time. Each music mood
// grows up to MUSIC_VARIANTS tracks, picked by the run's seed, so beds don't repeat back to back.
// Without ELEVENLABS_API_KEY a Short simply has no music or effects.

export type AudioCache = { get(key: string): Promise<Uint8Array | null>; put(key: string, bytes: Uint8Array): Promise<void> }

export const SFX = {
  hit: { prompt: "Deep cinematic impact hit with a sub bass boom and a short tail, punchy, clean, no music", seconds: 1.5 },
  whoosh: { prompt: "Fast airy whoosh swish transition, short and clean, no music", seconds: 0.8 },
} as const
export type SfxKind = keyof typeof SFX

const MUSIC_VARIANTS = 3
const MUSIC_MS = 45_000

/** Storage-backed cache (S3/GCS), shared by every workspace. */
export function storageCache(storage: { put(key: string, body: Uint8Array, mime: string): Promise<void>; getBytes(key: string): Promise<Uint8Array> }): AudioCache {
  return {
    get: (key) => storage.getBytes(`_shared/audio/${key}`).catch(() => null),
    put: (key, bytes) => storage.put(`_shared/audio/${key}`, bytes, "audio/mpeg"),
  }
}

/** Folder-backed cache for local scripts. */
export function diskCache(dir: string): AudioCache {
  return {
    get: async (key) => (existsSync(path.join(dir, key)) ? new Uint8Array(readFileSync(path.join(dir, key))) : null),
    put: async (key, bytes) => {
      mkdirSync(path.dirname(path.join(dir, key)), { recursive: true })
      writeFileSync(path.join(dir, key), bytes)
    },
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default"

function hash(seed: string) {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

async function elevenLabs(pathAndQuery: string, body: unknown, apiKey: string, f: typeof fetch) {
  const res = await f(`https://api.elevenlabs.io${pathAndQuery}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`ElevenLabs ${pathAndQuery.split("?")[0]}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`)
  return new Uint8Array(await res.arrayBuffer())
}

type Opts = { apiKey?: string; fetch?: typeof fetch }

/** A cached sound effect, or null when there's no key and nothing cached. */
export async function soundEffect(kind: SfxKind, cache: AudioCache, opts: Opts = {}): Promise<Uint8Array | null> {
  const key = `sfx/${kind}-v1.mp3`
  const cached = await cache.get(key)
  if (cached) return cached
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY
  if (!apiKey) return null
  const audio = await elevenLabs("/v1/sound-generation?output_format=mp3_44100_128", { text: SFX[kind].prompt, duration_seconds: SFX[kind].seconds, prompt_influence: 0.6 }, apiKey, opts.fetch ?? fetch)
  await cache.put(key, audio)
  return audio
}

/** An instrumental bed for the run's music mood, or null when there's no key and nothing cached. */
export async function musicBed(mood: string, seed: string, cache: AudioCache, opts: Opts = {}): Promise<Uint8Array | null> {
  const key = `music/${slug(mood)}-${hash(seed) % MUSIC_VARIANTS}.mp3`
  const cached = await cache.get(key)
  if (cached) return cached
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY
  if (!apiKey) return null
  const prompt = `${mood} instrumental background track for a short vertical social video. Energetic from the first second, steady groove, clean modern mix that leaves room for a voiceover. No vocals, no singing, no spoken words.`
  const audio = await elevenLabs("/v1/music?output_format=mp3_44100_128", { prompt, music_length_ms: MUSIC_MS }, apiKey, opts.fetch ?? fetch)
  await cache.put(key, audio)
  return audio
}
