import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { assembleShort, mediaSeconds, type AssemblyScene } from "./assemble"
import { musicBed, soundEffect, type AudioCache } from "./audio-assets"
import { buildAss } from "./captions"
import { log } from "./log"
import { performanceLine, pickVoice, wordTimings, type Narrator, type VoiceResult, type WordTime } from "./voice"

// From stored scene clips to the finished Short: narration, word timings, captions, music, effects,
// FFmpeg. Shared by the run engine and the local scripts, so a test render is what a run would post.

export type RenderPlan = {
  hook: string
  hook_text?: string
  narrator?: Narrator
  scenes: { purpose: string; duration_sec: number; transition_in?: AssemblyScene["transitionIn"]; voiceover_line: string; voiceover_performance?: string; caption_words: string }[]
}

export type Voices = {
  /** ElevenLabs directly (ELEVENLABS_API_KEY). Gets the line with its audio tags (speakExpressive). */
  elevenlabs: (taggedLine: string, voiceId: string) => Promise<VoiceResult>
  /** A voice the campaign locked (an ElevenLabs id). */
  lockedElevenLabsVoice?: string
}

export type RenderInput = {
  workDir: string
  plan: RenderPlan
  clips: string[] // one file per scene, inside workDir
  seed: string // the run id: picks voice and music variants
  musicMood?: string
  accent?: string
  voices: Voices
  audioCache: AudioCache
  nativeAudio?: boolean
}

export async function renderShort(input: RenderInput) {
  const { workDir, plan } = input
  const notes: string[] = []
  const note = (n: string) => {
    if (!notes.includes(n)) notes.push(n)
  }
  const voiceId = input.voices.lockedElevenLabsVoice ?? pickVoice(plan.narrator, input.seed) ?? "EXAVITQu4vr4xnSDxMaL"
  const voiceSource = { elevenlabs: 0, reused: 0, none: 0 }

  const scenes = []
  const words: WordTime[][] = []
  for (const [i, s] of plan.scenes.entries()) {
    const file = `vo-${i + 1}.mp3`
    // A line already in workDir (a local re-render) is reused, so it isn't paid for twice.
    let audio: Uint8Array | null = existsSync(path.join(workDir, file)) ? new Uint8Array(readFileSync(path.join(workDir, file))) : null
    if (audio) voiceSource.reused++
    if (!audio) {
      const r = await input.voices.elevenlabs(performanceLine(s), voiceId)
      if (r.ok) {
        audio = r.audio
        voiceSource.elevenlabs++
      } else {
        note(r.error)
        voiceSource.none++
      }
    }
    if (audio) writeFileSync(path.join(workDir, file), audio)
    const seconds = audio ? await mediaSeconds(file, workDir) : 0
    words.push(audio ? await wordTimings(audio, s.voiceover_line, seconds) : [])
    scenes.push({ clip: input.clips[i]!, durationSec: s.duration_sec, voiceover: audio ? file : null, transitionIn: s.transition_in })
  }

  // Music and effects are optional polish: a failure is noted, never fatal.
  const fetchAsset = async (name: string, get: () => Promise<Uint8Array | null>) => {
    try {
      const bytes = await get()
      if (!bytes) return null
      writeFileSync(path.join(workDir, name), bytes)
      return name
    } catch (err) {
      note((err as Error).message)
      return null
    }
  }
  const music = input.musicMood ? await fetchAsset("music.mp3", () => musicBed(input.musicMood!, input.seed, input.audioCache)) : null
  const hit = await fetchAsset("sfx-hit.mp3", () => soundEffect("hit", input.audioCache))
  const whoosh = plan.scenes.length > 1 ? await fetchAsset("sfx-whoosh.mp3", () => soundEffect("whoosh", input.audioCache)) : null

  // On-screen hook text for the first 2 seconds: the director's hook_text (6 words at most), or for
  // older plans the hook scene's key words.
  const hookText = (plan.hook_text?.trim() || plan.scenes[0]?.caption_words || plan.hook).split(/\s+/).slice(0, 6).join(" ")
  const result = await assembleShort(workDir, scenes, {
    nativeAudio: input.nativeAudio ?? true,
    music,
    sfx: { hit, whoosh },
    captions: (timeline) =>
      buildAss({
        accent: input.accent,
        hookTitle: { text: hookText, end: Math.min(timeline[0]!.end - 0.05, 2) },
        scenes: timeline.map((t, i) => ({
          ...t,
          caption: plan.scenes[i]!.caption_words,
          words: words[i]!.map((w) => ({ text: w.text, start: t.start + w.start, end: t.start + w.end })),
        })),
      }),
  })
  log.info("short rendered", { seed: input.seed, seconds: result.seconds, voice: voiceSource, music: !!music, sfx: !!(hit || whoosh) })
  return { ...result, notes, voiceSource }
}
