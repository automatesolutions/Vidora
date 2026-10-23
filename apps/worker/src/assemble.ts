import { execFile } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import ffmpegStatic from "ffmpeg-static"

// Assembles a vertical Short from scene clips with FFmpeg, in two passes:
//   1. each scene: 1080x1920, the edit's camera work (see motion: slow push, hook punch, a reframe
//      cut inside long shots, whip pans), film grain and vignette; the clip's own sound under the voice
//   2. the joined Short: burned-in captions and hook text (an ASS file, see captions.ts), a music bed
//      ducked under the voice, a hit on the cold open and whooshes on whip pans, loudness at -14 LUFS

const run = promisify(execFile)
export const FFMPEG = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string)
const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/fonts")
const FPS = 30

export type AssemblyScene = {
  clip: string // file name inside workDir
  durationSec: number
  voiceover?: string | null // mp3 file name inside workDir
  /** How the edit enters this scene (the director's choice); default a hard cut. */
  transitionIn?: "none" | "hard_cut" | "whip_pan" | "match_cut"
}

export type AssemblyOptions = {
  nativeAudio?: boolean
  /** Builds the ASS captions once scene start times are known (they depend on voiceover lengths). */
  captions?: (timeline: { start: number; end: number }[]) => string
  music?: string | null // mp3 inside workDir
  sfx?: { hit?: string | null; whoosh?: string | null }
}

/** Media length in seconds (0 if unknown), read from FFmpeg's banner. */
export async function mediaSeconds(file: string, cwd?: string) {
  const r = await run(FFMPEG, ["-i", file, "-f", "null", "-"], { cwd, maxBuffer: 16 * 1024 * 1024 }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }))
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

async function hasAudio(file: string, cwd: string) {
  const r = await run(FFMPEG, ["-i", file], { cwd }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }))
  return /Audio:/.test(r.stderr)
}

/** How long each scene runs: its clip length, or longer when its voiceover needs it. */
export async function sceneLengths(workDir: string, scenes: AssemblyScene[]) {
  const lengths: number[] = []
  for (const s of scenes) {
    const hasVo = !!s.voiceover && existsSync(path.join(workDir, s.voiceover))
    lengths.push(Math.max(s.durationSec, hasVo ? (await mediaSeconds(s.voiceover!, workDir)) + 0.35 : 0))
  }
  return lengths
}

/** Shots this long get a reframe cut halfway, so the frame changes every 1.5-2.5 s. */
const REFRAME_FROM_SEC = 3.6
const WHIP_FRAMES = 5

export type SceneMotion = { hook: boolean; whipIn: boolean; whipOut: boolean }

/**
 * The camera work the edit adds to one scene, as one zoompan (it works in the 1.5x canvas, so moves
 * stay sharp). Expressions are quoted, so their commas need no escaping.
 *   - always: a slow push-in across the shot, so nothing is ever static
 *   - the hook: a quick punch-in settle on the first frames (it opens mid-action, never a fade)
 *   - long shots: a hard reframe cut halfway, tighter and lifted toward the subject (upper frame)
 *   - whip pans: the outgoing shot whips out to the right and the next whips in from the left
 */
export function motion(length: number, m: SceneMotion) {
  const frames = Math.max(1, Math.round(length * FPS))
  const cut = length >= REFRAME_FROM_SEC ? Math.round(frames * 0.5) : null
  const whipIn = m.whipIn ? `max(0,1-on/${WHIP_FRAMES})` : "0"
  const whipOut = m.whipOut ? `max(0,(on-${frames - WHIP_FRAMES})/${WHIP_FRAMES})` : "0"
  const z = [
    "1",
    `0.05*on/${frames}`,
    m.hook ? "0.08*max(0,1-on/6)" : null,
    cut !== null ? `if(gte(on,${cut}),0.16,0)` : null,
    m.whipIn || m.whipOut ? `0.35*(${whipIn}+${whipOut})` : null,
  ]
    .filter(Boolean)
    .join("+")
  // x: centered, swinging edge to edge during a whip. y: centered, lifted after the reframe cut.
  const x = `(iw-iw/zoom)/2*(1-${whipIn}+${whipOut})`
  const y = cut !== null ? `(ih-ih/zoom)/2*if(gte(on,${cut}),0.6,1)` : "(ih-ih/zoom)/2"
  return `zoompan=z='${z}':d=1:x='${x}':y='${y}':s=1080x1920:fps=${FPS}`
}

/** Motion blur on the whip frames only. */
function whipBlur(length: number, m: SceneMotion) {
  const span = (WHIP_FRAMES / FPS).toFixed(3)
  const when = [m.whipIn ? `lt(t,${span})` : null, m.whipOut ? `gte(t,${(length - WHIP_FRAMES / FPS).toFixed(3)})` : null].filter(Boolean).join("+")
  return when ? `,dblur=angle=0:radius=48:enable='${when}'` : ""
}

/** One film look over every clip: subtle temporal grain and a soft vignette. */
const FILM = "noise=c0s=6:c0f=t+u,vignette=angle=PI/7"

/** Builds `<workDir>/final.mp4`. Returns its path and total length. */
export async function assembleShort(workDir: string, scenes: AssemblyScene[], opts: AssemblyOptions = {}) {
  const lengths = await sceneLengths(workDir, scenes)
  const timeline: { start: number; end: number }[] = []
  const parts: string[] = []
  let total = 0

  for (const [i, s] of scenes.entries()) {
    const length = lengths[i]!
    timeline.push({ start: total, end: total + length })
    total += length
    const hasVo = !!s.voiceover && existsSync(path.join(workDir, s.voiceover))
    const m: SceneMotion = { hook: i === 0, whipIn: i > 0 && s.transitionIn === "whip_pan", whipOut: scenes[i + 1]?.transitionIn === "whip_pan" }
    const video = `[0:v]scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,fps=${FPS},setsar=1,tpad=stop_mode=clone:stop_duration=${length},trim=0:${length.toFixed(2)},setpts=PTS-STARTPTS,${motion(length, m)}${whipBlur(length, m)},${FILM},setsar=1[v]`
    const fit = `aformat=sample_rates=44100:channel_layouts=stereo,apad,atrim=0:${length.toFixed(2)},asetpts=PTS-STARTPTS`
    const clipAudio = !!opts.nativeAudio && (await hasAudio(s.clip, workDir))
    const audio = clipAudio && hasVo ? `[0:a]volume=0.25,${fit}[n];[1:a]${fit}[vo];[n][vo]amix=inputs=2:duration=longest:normalize=0[a]` : clipAudio ? `[0:a]${fit}[a]` : `[1:a]${fit}[a]`
    const part = `part-${i + 1}.mp4`
    await run(
      FFMPEG,
      [
        "-y", "-i", s.clip,
        ...(hasVo ? ["-i", s.voiceover!] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]),
        "-filter_complex", `${video};${audio}`,
        "-map", "[v]", "-map", "[a]", "-t", length.toFixed(2),
        "-map_metadata", "-1", "-map_chapters", "-1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        part,
      ],
      { cwd: workDir, maxBuffer: 64 * 1024 * 1024 }
    )
    parts.push(part)
  }
  writeFileSync(path.join(workDir, "parts.txt"), parts.map((p) => `file '${p}'`).join("\n"))
  await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", "parts.txt", "-c", "copy", "joined.mp4"], { cwd: workDir })

  // ── Pass 2: captions, music, effects, loudness ──
  const inputs: string[] = ["-i", "joined.mp4"]
  const filters: string[] = []
  const mix: string[] = ["[main]"]
  let video = "[0:v]"
  if (opts.captions && existsSync(FONTS_DIR)) {
    writeFileSync(path.join(workDir, "captions.ass"), opts.captions(timeline))
    mkdirSync(path.join(workDir, "fonts"), { recursive: true })
    for (const f of readdirSync(FONTS_DIR).filter((f) => f.endsWith(".ttf"))) copyFileSync(path.join(FONTS_DIR, f), path.join(workDir, "fonts", f))
    filters.push("[0:v]ass=captions.ass:fontsdir=fonts[v]")
    video = "[v]"
  }
  const music = opts.music && existsSync(path.join(workDir, opts.music)) ? opts.music : null
  filters.push(music ? "[0:a]asplit=2[main][key]" : "[0:a]anull[main]")
  let n = 1
  if (music) {
    inputs.push("-stream_loop", "-1", "-i", music)
    // Music is in from the first frame (no slow fade-in) and ends with a short tail, so the Short
    // loops cleanly back to its first frame. It ducks under the voice: the joined track drives the compressor.
    const fadeOut = Math.max(0, total - 0.35).toFixed(2)
    filters.push(`[${n}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${total.toFixed(2)},volume=0.32,afade=t=in:d=0.05,afade=t=out:st=${fadeOut}:d=0.35[mus]`)
    filters.push("[mus][key]sidechaincompress=threshold=0.025:ratio=9:attack=15:release=350:makeup=1[duck]")
    mix.push("[duck]")
    n++
  }
  const hits: { file: string; at: number; volume: number }[] = []
  // Effects stay cinematic: one low hit under the cold open and a whoosh on whip pans only. Hard cuts
  // and match cuts stay clean.
  if (opts.sfx?.hit && existsSync(path.join(workDir, opts.sfx.hit))) hits.push({ file: opts.sfx.hit, at: 0, volume: 0.5 })
  if (opts.sfx?.whoosh && existsSync(path.join(workDir, opts.sfx.whoosh))) {
    for (const [i, t] of timeline.entries()) {
      if (i > 0 && scenes[i]!.transitionIn === "whip_pan") hits.push({ file: opts.sfx.whoosh, at: Math.max(0, t.start - 0.25), volume: 0.5 })
    }
  }
  for (const h of hits) {
    inputs.push("-i", h.file)
    const ms = Math.round(h.at * 1000)
    filters.push(`[${n}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${h.volume},adelay=${ms}|${ms}[s${n}]`)
    mix.push(`[s${n}]`)
    n++
  }
  filters.push(`${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]`)
  await run(
    FFMPEG,
    [
      "-y", ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", video === "[v]" ? "[v]" : "0:v", "-map", "[a]", "-t", total.toFixed(2),
      "-c:v", video === "[v]" ? "libx264" : "copy", ...(video === "[v]" ? ["-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p"] : []),
      // No metadata from the source clips (generator tags) reaches the finished file.
      "-map_metadata", "-1", "-map_chapters", "-1", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
      "mixed.mp4",
    ],
    { cwd: workDir, maxBuffer: 64 * 1024 * 1024 }
  )
  await levelLoudness(workDir, "mixed.mp4", "final.mp4")
  return { file: path.join(workDir, "final.mp4"), seconds: total, timeline }
}

const TARGET_LUFS = -14

/**
 * Single-pass loudnorm lands a dB or two short of the target, so measure the result and apply the
 * remaining gain (a limiter catches peaks). Audio only: the video is copied.
 */
async function levelLoudness(workDir: string, input: string, output: string) {
  const r = await run(FFMPEG, ["-i", input, "-map", "0:a", "-af", "ebur128=framelog=quiet", "-f", "null", "-"], { cwd: workDir, maxBuffer: 16 * 1024 * 1024 }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }))
  const measured = Number(/I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.slice(r.stderr.lastIndexOf("Summary")))?.[1])
  const gain = Number.isFinite(measured) ? Math.min(6, TARGET_LUFS - measured) : 0
  if (Math.abs(gain) < 0.3) {
    copyFileSync(path.join(workDir, input), path.join(workDir, output))
    return
  }
  await run(
    FFMPEG,
    ["-y", "-i", input, "-map", "0:v", "-map", "0:a", "-map_metadata", "-1", "-c:v", "copy", "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=false,aresample=44100`, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output],
    { cwd: workDir, maxBuffer: 64 * 1024 * 1024 }
  )
}

/** A JPEG frame for the thumbnail. */
export async function grabFrame(workDir: string, video: string, atSec: number, out = "thumbnail.jpg") {
  await run(FFMPEG, ["-y", "-ss", atSec.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", out], { cwd: workDir })
  return path.join(workDir, out)
}
