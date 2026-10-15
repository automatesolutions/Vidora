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
