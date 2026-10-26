import type { WordTime } from "./voice"

// Burned-in captions as an ASS subtitle file (FFmpeg's `ass` filter, fonts from assets/fonts):
//   - word-by-word captions, 1-3 words at a time, the spoken word highlighted and enlarged, each
//     chunk popping in; they sit at about 72% height, under the subject and above YouTube's own UI
//   - the hook text (6 words or fewer) slamming in over the first 2 seconds in the lower third, black on the accent
//     color; word captions start when it leaves, so there's never two blocks of text at once
// Times are seconds from the start of the finished Short.

export type CaptionScene = { start: number; end: number; caption: string; words: WordTime[] }

export type CaptionTrack = {
  scenes: CaptionScene[]
  hookTitle?: { text: string; end: number }
  accent?: string // "#RRGGBB", default a bright yellow
}

const W = 1080
const H = 1920
const CAPTION_Y = 1380
// The hook text sits where the captions go (they wait until it's gone): the lower third, which the
// director keeps free of faces. Up top it covered the presenter's face.
const HOOK_Y = CAPTION_Y
const MAX_CHUNK_CHARS = 16

/** "#FFD60A" → ASS "&H000AD6FF" (alpha, blue, green, red). */
export function assColor(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return "&H000AD6FF"
  return `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase()
}

function time(s: number) {
  const cs = Math.max(0, Math.round(s * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const sec = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`
}

/** Caption text is shown in caps; braces and backslashes would be read as ASS commands. */
const clean = (s: string) => s.replace(/[{}\\]/g, "").toUpperCase()

/** Words into short chunks: at most 3 words and MAX_CHUNK_CHARS, breaking after punctuation. */
export function chunkWords(words: WordTime[]): WordTime[][] {
  const chunks: WordTime[][] = []
  let cur: WordTime[] = []
  for (const w of words) {
    const len = [...cur, w].map((x) => x.text).join(" ").length
    if (cur.length && (cur.length >= 3 || len > MAX_CHUNK_CHARS)) {
      chunks.push(cur)
      cur = []
    }
    cur.push(w)
    if (/[.,!?;:…]$/.test(w.text)) {
      chunks.push(cur)
      cur = []
    }
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/** Font size that keeps a line inside the frame (measured: Montserrat caps with the outline run about 0.42 em). */
function fitSize(text: string, max: number, width = W - 120) {
  return Math.min(max, Math.floor(width / (Math.max(text.length, 1) * 0.42)))
}

/** Breaks a hook title into at most two balanced lines. */
function hookLines(text: string) {
  const words = clean(text).split(/\s+/).filter(Boolean)
  if (words.join(" ").length <= 14 || words.length < 2) return [words.join(" ")]
  let best = 1
  let bestDiff = Infinity
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length)
    if (diff < bestDiff) [best, bestDiff] = [i, diff]
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")]
}

export function buildAss(track: CaptionTrack): string {
  const accent = assColor(track.accent ?? "#FFD60A")
  const events: string[] = []
  // One block of text at a time: spoken-word captions wait until the hook text has gone.
  const captionsFrom = track.hookTitle?.text.trim() ? track.hookTitle.end : 0
  const add = (layer: number, start: number, end: number, style: string, text: string) => {
    if (style === "Caption") start = Math.max(start, captionsFrom)
    if (end - start >= 0.04) events.push(`Dialogue: ${layer},${time(start)},${time(end)},${style},,0,0,0,,${text}`)
  }

  for (const scene of track.scenes) {
    if (!scene.words.length) {
      // No narration timings: the scene's key words, popping in for the whole scene.
      const text = clean(scene.caption)
      if (text) add(1, scene.start, scene.end, "Caption", `{\\an5\\pos(${W / 2},${CAPTION_Y})\\fs${fitSize(text, 140)}\\fscx80\\fscy80\\t(0,100,\\fscx100\\fscy100)}${text}`)
      continue
    }
    const chunks = chunkWords(scene.words)
    chunks.forEach((chunk, ci) => {
      const next = chunks[ci + 1]?.[0]?.start
      const chunkEnd = Math.min(scene.end, next !== undefined && next - chunk.at(-1)!.end < 0.6 ? next : chunk.at(-1)!.end + 0.2)
      const texts = chunk.map((w) => clean(w.text))
      const size = fitSize(texts.join(" "), 150)
      chunk.forEach((w, wi) => {
        const start = wi === 0 ? chunk[0]!.start : w.start
        const end = wi === chunk.length - 1 ? chunkEnd : chunk[wi + 1]!.start
        const pop = wi === 0 ? "\\fscx78\\fscy78\\t(0,90,\\fscx100\\fscy100)" : ""
        const line = texts.map((t, k) => (k === wi ? `{\\c${accent}&\\fscx108\\fscy108}${t}{\\c&H00FFFFFF&\\fscx100\\fscy100}` : t)).join(" ")
        add(1, start, end, "Caption", `{\\an5\\pos(${W / 2},${CAPTION_Y})\\fs${size}${pop}}${line}`)
      })
    })
  }

  if (track.hookTitle?.text.trim()) {
    const lines = hookLines(track.hookTitle.text)
    const size = Math.min(...lines.map((l) => fitSize(l, 170, W - 200)))
    // Visible from the first frame: slams down from oversized, overshoots, settles, then cuts out
    // fast. No fade-in, no tilt.
    const fx = `\\an5\\pos(${W / 2},${HOOK_Y})\\fs${size}\\fscx150\\fscy150\\t(0,110,\\fscx94\\fscy94)\\t(110,200,\\fscx100\\fscy100)\\fad(0,150)`
    add(2, 0, Math.max(0.6, track.hookTitle.end), "Hook", `{${fx}}${lines.join("\\N")}`)
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Montserrat ExtraBold,140,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,10,6,5,60,60,0,1
Style: Hook,Montserrat Black,118,&H00141414,&H00141414,${accent},&H00000000,0,0,0,0,100,100,0,0,3,22,0,5,110,110,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`
}
