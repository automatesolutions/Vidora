import { execFile } from "node:child_process"
import { copyFileSync, existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import ffmpegStatic from "ffmpeg-static"

// Assembles a vertical Short from scene clips with FFmpeg: 1080x1920 crop, burned-in captions, the
// voiceover on top of the clip's own sound (or silence), then all scenes joined.

const run = promisify(execFile)
export const FFMPEG = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string)

export type AssemblyScene = {
  clip: string // file name inside workDir
  durationSec: number
  caption: string
  voiceover?: string | null // mp3 file name inside workDir
}

const FONTS = ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/noto/NotoSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]

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

/** Builds `<workDir>/final.mp4`. Returns its path and total length. */
export async function assembleShort(workDir: string, scenes: AssemblyScene[], opts: { nativeAudio?: boolean } = {}) {
  const font = FONTS.find(existsSync)
  if (font) copyFileSync(font, path.join(workDir, "caption-font.ttf"))
  const parts: string[] = []
  let total = 0

  for (const [i, s] of scenes.entries()) {
    const hasVo = !!s.voiceover && existsSync(path.join(workDir, s.voiceover))
    const length = Math.max(s.durationSec, hasVo ? (await mediaSeconds(s.voiceover!, workDir)) + 0.35 : 0)
    total += length
    const caption = s.caption.toUpperCase()
    writeFileSync(path.join(workDir, `cap-${i + 1}.txt`), caption)
    // Bold caps run about 0.62 em wide: shrink long captions so they stay inside 86% of the width.
    const fontSize = Math.min(78, Math.floor((1080 * 0.86) / (Math.max(caption.length, 1) * 0.62)))
    const captions = font
      ? `,drawtext=fontfile=caption-font.ttf:textfile=cap-${i + 1}.txt:expansion=none:fontcolor=white:fontsize=${fontSize}:borderw=7:bordercolor=black:x=(w-text_w)/2:y=h*0.76`
      : ""
    const video = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,tpad=stop_mode=clone:stop_duration=${length}${captions},trim=0:${length.toFixed(2)},setpts=PTS-STARTPTS[v]`
    const fit = `aformat=sample_rates=44100:channel_layouts=stereo,apad,atrim=0:${length.toFixed(2)},asetpts=PTS-STARTPTS`
    const clipAudio = !!opts.nativeAudio && (await hasAudio(s.clip, workDir))
    const audio = clipAudio && hasVo ? `[0:a]volume=0.3,${fit}[n];[1:a]${fit}[vo];[n][vo]amix=inputs=2:duration=longest:normalize=0[a]` : clipAudio ? `[0:a]${fit}[a]` : `[1:a]${fit}[a]`
    const part = `part-${i + 1}.mp4`
    await run(
      FFMPEG,
      [
        "-y", "-i", s.clip,
        ...(hasVo ? ["-i", s.voiceover!] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]),
        "-filter_complex", `${video};${audio}`,
        "-map", "[v]", "-map", "[a]", "-t", length.toFixed(2),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
        part,
      ],
      { cwd: workDir, maxBuffer: 64 * 1024 * 1024 }
    )
    parts.push(part)
  }
  writeFileSync(path.join(workDir, "parts.txt"), parts.map((p) => `file '${p}'`).join("\n"))
  await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", "parts.txt", "-c", "copy", "-movflags", "+faststart", "final.mp4"], { cwd: workDir })
  return { file: path.join(workDir, "final.mp4"), seconds: total }
}

/** A JPEG frame for the thumbnail. */
export async function grabFrame(workDir: string, video: string, atSec: number, out = "thumbnail.jpg") {
  await run(FFMPEG, ["-y", "-ss", atSec.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", out], { cwd: workDir })
  return path.join(workDir, out)
}
