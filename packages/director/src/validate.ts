import { jaccard, normalizeText, shingles } from "@vidora/core"
import { avoidLine, BASE_NEGATIVE, SOURCE_NEGATIVE, DEFAULTS, promptBudget, SHOT_SECONDS, SPEECH_RATE, targetSeconds, type DirectorInput, type DirectorModel } from "./context"
import type { Plan } from "./schemas"

// Deterministic checks on a director plan. Messages are phrased as instructions because they go
// straight back to Claude for repair.
//   error: the plan can't go to Higgsfield like this (wasted money or a broken video)
//   warn:  worth one repair attempt, but acceptable if it persists

export type Issue = { severity: "error" | "warn"; message: string }

// Asking a video model to render text gives garbled letters; captions are ours to add.
const TEXT_REQUEST =
  /\b(text|caption|captions|subtitle|subtitles|title card|lettering|logo|logos|watermark|headline|signage|sign that (?:says|reads)|words? (?:on|appear)|written|typography)\b/i
const CUT_WORDS = /\b(then cut to|cut to|montage|split screen|transition to|scene changes)\b/i
// Prompts state locks like "NO logos" and "no cuts, no montage"; a negated mention is a rule, not a request.
const NEGATED = /\b(no|not|never|zero|without|nothing|avoid)\b[^.;:\n]{0,60}$/i
// The labeled sections the system prompt asks for (prompts.ts); missing ones usually mean a flat prompt.
const SECTIONS = ["SHOT:", "FIRST FRAME:", "ACTION:"]
// Where the shared look starts; a scene prompt that repeats it gets trimmed back (autoFix).
const SHARED = /\b(?:LIGHTING|COLOR GRADE|STYLE|OUTPUT|LOCKS|AVOID):/

export const OUTPUT_LINE =
  "OUTPUT: Upright, level, vertical 9:16 composition; faces in the upper half, never in the lower third. Always moving, very slight handheld feel; first frame mid-action. Real human motion: subtle breathing, natural blinking, relaxed head turns, unhurried movement; same face and hands throughout; true skin texture; correct anatomy and physics; 24fps film look, no flicker. Phones held loosely, screen away or out of frame, nothing readable. NO ONE SPEAKS: lips closed or relaxed. FLOW: constant motion first frame to last, steady speed; no pause, freeze, or hold; ends mid-movement."

// Pacing and hook checks.
const STATIC_MOVE = /\b(static|locked[- ]?off|still frame|no camera movement)\b/i
const SLOW_OPEN = /\b(fades? in|fade from black|establishing shot|empty frame|slowly reveals?|title card|logo)\b/i
// Lines that tell viewers the video is ending, or stall it; both cost retention.
const FILLER = /\b(thanks for watching|let me know what you think|subscribe for more|like and subscribe|that's it for|in this video|let's get started|let's dive in|without further ado)\b/i
const LINEAR = /\band then\b/i
/** Shot size buckets, so "close-up" and "tight close-up" count as the same size. */
function shotSize(t: string) {
  if (/extreme close|macro|detail/i.test(t)) return "ecu"
  if (/close/i.test(t)) return "cu"
  if (/wide|establishing|full/i.test(t)) return "wide"
  if (/medium/i.test(t)) return "medium"
  return t.toLowerCase().trim()
}

/**
 * The prompts we send: each scene's own sections, then the look written once for the whole video.
 * Models without a negative prompt also get the AVOID line, since nothing else would carry it.
 */
export function assemble(plan: Plan, model: Pick<DirectorModel, "supportsNegativePrompt">, nicheSource = false): Plan {
  const tail = sharedTail(plan, model, nicheSource)
  return { ...plan, scenes: plan.scenes.map((s) => ({ ...s, prompt: `${s.prompt} ${tail}` })) }
}

function sharedTail(plan: Plan, model: Pick<DirectorModel, "supportsNegativePrompt">, nicheSource: boolean) {
  const l = plan.look
  const avoid = model.supportsNegativePrompt ? "" : ` ${avoidLine(nicheSource)}`
  return `LIGHTING: ${l.lighting.trim()} COLOR GRADE: ${l.color_grade.trim()} STYLE: ${l.style.trim()} ${OUTPUT_LINE} LOCKS: ${l.locks.trim()}${avoid}`
}

const SECTION = /\b(SHOT|SUBJECT|LOCATION|FIRST FRAME|OPTICS|CAMERA|ACTION|PERFORMANCE|PHYSICS|AUDIO):/g
// Dropped in this order when a prompt is over the model's limit; SHOT, SUBJECT, FIRST FRAME, CAMERA and ACTION always stay.
const DROP_ORDER = ["PHYSICS", "OPTICS", "PERFORMANCE", "LOCATION", "AUDIO"]

/**
 * A scene's own sections cut down to `room` characters: whole low-priority sections first, so the
 * shot, anchor, first frame, camera move, and timed beats survive; a sentence-boundary cut only if that isn't enough.
 */
export function fitPrompt(own: string, room: number) {
  // With almost no room the look itself is the problem; leave it to validation and repair.
  if (own.length <= room || room < 400) return own
  const starts = [...own.matchAll(SECTION)]
  if (!starts.length) return clip(own, room)
  const sections = starts.map((m, i) => ({ label: m[1]!, text: own.slice(m.index, starts[i + 1]?.index ?? own.length).trim() }))
  const lead = own.slice(0, starts[0]!.index).trim()
  const join = (list: typeof sections) => [lead, ...list.map((s) => s.text)].filter(Boolean).join(" ")
  let kept = sections
  for (const label of DROP_ORDER) {
    if (join(kept).length <= room) break
    kept = kept.filter((s) => s.label !== label)
  }
  return clip(join(kept), room)
}

/** Cut at the last sentence end that fits (or the last space). */
function clip(text: string, room: number) {
  if (text.length <= room) return text
  const head = text.slice(0, room)
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"))
  return (end > room * 0.6 ? head.slice(0, end + 1) : head.slice(0, head.lastIndexOf(" "))).trim()
}

/** A scene's own sections, without the shared look and locks we append (they name things to avoid). */
const ownPart = (prompt: string) => prompt.split(SHARED)[0]!

/** The first match of `re` in `p` that isn't negated by the words just before it. */
function requested(re: RegExp, p: string) {
  for (const m of p.matchAll(new RegExp(re.source, "gi"))) {
    if (!NEGATED.test(p.slice(Math.max(0, m.index - 80), m.index))) return m
  }
  return null
}

/** The FIRST FRAME through ACTION sections of a labeled prompt, or the whole prompt if it has no sections. */
function actionOf(p: string) {
  const start = p.indexOf("FIRST FRAME:")
  const end = p.indexOf("PERFORMANCE:")
  return start >= 0 ? p.slice(start, end > start ? end : undefined) : p
}

/** Fixes we can make ourselves, before spending a repair call. Returns a new plan. */
export function autoFix(plan: Plan, input: DirectorInput): Plan {
  // Over-long prompts get trimmed here instead of failing the run (the model's character limit is hard).
  const room = promptBudget(input.model).max - sharedTail(plan, input.model, !!input.nicheStudy).length - 1
  const scenes = plan.scenes.map((s, i) => ({
    ...s,
    prompt: fitPrompt(s.prompt.split(SHARED)[0]!.replace(/\s+/g, " ").trim(), room),
    negative_prompt: input.model.supportsNegativePrompt ? mergeNegative(s.negative_prompt, !!input.nicheStudy) : "",
    // Scene 1 is the cold open; every later scene needs a real transition.
    transition_in: i === 0 ? ("none" as const) : s.transition_in === "none" ? ("hard_cut" as const) : s.transition_in,
  }))
  const last = Math.max(0, scenes.length - 1)
  const clamp = (n: number) => Math.min(Math.max(0, Math.round(n)), last)
  return {
    ...plan,
    scenes,
    voiceover_script: scenes.map((s) => s.voiceover_line.trim()).join(" "),
    hashtags: [...new Set(plan.hashtags.map((h) => h.trim()).filter(Boolean))].slice(0, 10),
    thumbnail_scene_index: Math.min(Math.max(0, plan.thumbnail_scene_index), Math.max(0, scenes.length - 1)),
    title: plan.title.replace(/#\S+/g, "").replace(/\s+/g, " ").trim(),
    hook_text: plan.hook_text.replace(/\s+/g, " ").trim(),
    open_loop: { ...plan.open_loop, planted_in_scene: clamp(plan.open_loop.planted_in_scene), paid_off_in_scene: clamp(plan.open_loop.paid_off_in_scene) },
  }
}

/** The plan's negatives plus BASE_NEGATIVE (and SOURCE_NEGATIVE for niche source videos), without repeats. */
function mergeNegative(own: string, nicheSource: boolean) {
  const seen = new Set<string>()
  return [...own.split(","), ...BASE_NEGATIVE.split(","), ...(nicheSource ? SOURCE_NEGATIVE.split(",") : [])]
    .map((t) => t.trim())
    .filter((t) => {
      const key = t.toLowerCase()
      if (!t || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(", ")
}

export function validatePlan(plan: Plan, input: DirectorInput, hook: string): Issue[] {
  const issues: Issue[] = []
  const error = (message: string) => issues.push({ severity: "error", message })
  const warn = (message: string) => issues.push({ severity: "warn", message })

  const seconds = targetSeconds(input.brief)
  const lang = (input.brief.language ?? DEFAULTS.language).split("-")[0]!
  const rate = SPEECH_RATE[lang] ?? SPEECH_RATE.en!
  const budget = promptBudget(input.model, !!input.nicheStudy)
  const allowed = input.model.durations.length ? input.model.durations : [5]
  const scenes = assemble(plan, input.model, !!input.nicheStudy).scenes // check what Higgsfield will receive

  // Structure
  if (scenes.length < 2) error("Use at least 2 scenes.")
  if (scenes.length > 12) error(`Use at most 12 scenes (you used ${scenes.length}).`)
  if (scenes[0] && scenes[0].purpose !== "hook") error('Scene 1 must have purpose "hook".')
  if (scenes.length > 1 && scenes.at(-1)!.purpose !== "cta") warn('The last scene should have purpose "cta".')

  const total = scenes.reduce((s, x) => s + x.duration_sec, 0)
  const minTotal = seconds - 3
  const maxTotal = Math.min(seconds + 5, DEFAULTS.maxLengthSec)
  if (total > DEFAULTS.maxLengthSec) error(`Scene durations add up to ${total} s; a Short must stay under 60 s. Make them add up to ${minTotal}-${maxTotal} s.`)
  else if (total < minTotal || total > maxTotal) warn(`Scene durations add up to ${total} s; make them add up to ${minTotal}-${maxTotal} s.`)

  // Hook
  if (normalizeText(plan.hook) !== normalizeText(hook)) error(`The hook must be exactly: "${hook}".`)
  if (!normalizeText(scenes[0]?.voiceover_line ?? "").startsWith(normalizeText(hook))) error("Scene 1's voiceover_line must start with the hook, word for word.")

  // Attention: hook text, open loop, a fast cold open
  const hookWords = normalizeText(plan.hook_text).split(" ").filter(Boolean).length
  if (!hookWords) warn("Add hook_text: bold on-screen text for the first 2 seconds, 6 words or fewer.")
  else if (hookWords > 6) warn(`hook_text has ${hookWords} words; cut it to 6 or fewer.`)
  const startOf = (i: number) => scenes.slice(0, i).reduce((t, s) => t + s.duration_sec, 0)
  if (startOf(plan.open_loop.planted_in_scene) >= 5) warn("Plant the open loop in the first 5 seconds (scene 1, or a scene that starts before 5 s).")
  if (scenes.length > 2 && plan.open_loop.paid_off_in_scene < scenes.length - 2) warn("Pay off the open loop in one of the last two scenes, not earlier.")
  if (!plan.loop_ending.trim()) warn("Describe loop_ending: how the final shot echoes the first frame so the Short loops.")
  // Fast pacing, within what the model allows (a model whose shortest clip is 5 s can't do 3 s shots).
  const shortest = Math.min(...allowed.filter((d) => d >= SHOT_SECONDS.min), Math.max(...allowed))
  const hookMax = Math.max(SHOT_SECONDS.hookMax, shortest)
  const shotMax = Math.max(SHOT_SECONDS.max, shortest)
  if (scenes[0] && scenes[0].duration_sec > hookMax) warn(`Scene 1 (the hook) runs ${scenes[0].duration_sec} s; keep it to ${hookMax} s so the next shot arrives fast.`)
  if (scenes[0] && requested(SLOW_OPEN, actionOf(scenes[0].prompt))) warn("Scene 1 must open mid-action on a striking image: no fade-in, establishing shot, slow reveal, or logo.")

  // Narration fits the time
  const words = (s: string) => normalizeText(s).split(" ").filter(Boolean).length
  const totalWords = words(scenes.map((s) => s.voiceover_line).join(" "))
  const targetWords = total * rate
  if (totalWords > targetWords * 1.2) warn(`The narration has ${totalWords} words; cut it to about ${Math.round(targetWords)} so it fits ${total} s.`)
  if (totalWords < targetWords * 0.45) warn(`The narration has only ${totalWords} words; write about ${Math.round(targetWords * 0.8)} so the video isn't mostly silent.`)

  // Story momentum (viral strategy, 2026-10-26). The CTA scene speaks the creator's own wording, so it's skipped.
  scenes.slice(0, -1).forEach((s, i) => {
    const filler = s.voiceover_line.match(FILLER)
    if (filler) warn(`Scene ${i + 1}: cut "${filler[0]}"; never signal the ending or pad with filler, keep the story moving.`)
    if (i > 0 && LINEAR.test(s.voiceover_line)) warn(`Scene ${i + 1}: replace "and then" with a "but" or "so" turn, so each step causes or blocks the next.`)
  })

  // The creator's banned topics
  const everything = normalizeText([plan.title, plan.description, plan.voiceover_script, plan.cta_line, ...scenes.map((s) => s.prompt)].join(" "))
  for (const banned of input.brief.bannedTopics ?? []) {
    if (banned.trim() && everything.includes(normalizeText(banned))) error(`Remove every mention of "${banned}"; the creator banned it.`)
  }

  // Scenes and their prompts
  const anchor = plan.subject_anchor.trim()
  scenes.forEach((s, i) => {
    const n = `Scene ${i + 1}`
    const p = s.prompt
    if (!allowed.includes(s.duration_sec)) error(`${n}: duration ${s.duration_sec} s isn't allowed by this model; use one of ${allowed.join(", ")}.`)
    if (p.length > budget.max) error(`${n}: with the shared look the prompt is ${p.length} characters; this model's limit is ${budget.max}, so shorten this scene's sections.`)
    if (p.length < budget.min) warn(`${n}: the prompt is only ${p.length} characters; describe the shot in at least ${budget.min}.`)
    if (i > 0 && s.duration_sec > shotMax) warn(`${n}: ${s.duration_sec} s is slow for a Short; use shots of ${SHOT_SECONDS.min}-${shotMax} s (split it into two shots of different sizes).`)
    if (STATIC_MOVE.test(s.shot.camera_motion)) warn(`${n}: no static shots; give it one camera move (slow push-in, handheld follow, tracking …).`)
    if (i > 0 && shotSize(s.shot.shot_type) === shotSize(scenes[i - 1]!.shot.shot_type)) warn(`${n}: same shot size as the scene before (${s.shot.shot_type}); alternate wide, medium, close-up, and extreme close-up.`)
    const missing = SECTIONS.filter((h) => !p.includes(h))
    if (missing.length) warn(`${n}: write the prompt as labeled sections; it's missing ${missing.join(", ")}.`)
    else if (!/\d(?:\.\d)?\s*[-–]\s*\d(?:\.\d)?\s*s/.test(p.slice(p.indexOf("ACTION:")))) warn(`${n}: give ACTION timed beats ("0.0-1.5s: …") with the hero moment in capitals.`)
    const text = requested(TEXT_REQUEST, ownPart(p))
    if (text) error(`${n}: the prompt mentions "${text[0]}". Video models can't render text or logos well; show the real thing instead (captions are added later).`)
    const cut = requested(CUT_WORDS, ownPart(p))
    if (cut) error(`${n}: one prompt is one continuous shot; remove "${cut[0]}".`)
    const move = normalizeText(s.shot.camera_motion).split(" ").filter((w) => w.length > 3).slice(0, 2)
    if (move.length && !move.every((w) => normalizeText(p).includes(w))) warn(`${n}: the prompt should describe its camera move ("${s.shot.camera_motion}").`)
    if (anchor && s.features_anchor && !p.includes(anchor)) error(`${n}: paste the subject_anchor into the prompt word for word.`)
    if (input.model.supportsNegativePrompt && !s.negative_prompt) warn(`${n}: fill in negative_prompt (on-screen text, watermark, distorted hands, flicker …).`)
    if (words(s.voiceover_line) > s.duration_sec * rate * 1.35) warn(`${n}: "${s.voiceover_line}" is too long for ${s.duration_sec} s; shorten it or lengthen the scene.`)
  })

  // Near-identical prompts look like a loop. Light, style, and locks repeat on purpose, so compare the action.
  for (let i = 0; i < scenes.length; i++) {
    for (let j = i + 1; j < scenes.length; j++) {
      const a = shingles(actionOf(scenes[i]!.prompt).replace(anchor, ""))
      const b = shingles(actionOf(scenes[j]!.prompt).replace(anchor, ""))
      if (jaccard(a, b) > 0.6) warn(`Scenes ${i + 1} and ${j + 1} describe nearly the same shot; change the shot type, action, or setting of one.`)
    }
  }

  if (plan.title.length > 90) warn(`Shorten the title to under 70 characters (it's ${plan.title.length}).`)
  if (!plan.title.trim()) error("Add a title.")
  return issues
}

/** Checks one rewritten prompt (moderation retry) against the same prompt rules. */
export function validatePrompt(prompt: string, input: Pick<DirectorInput, "model">, anchor = ""): Issue[] {
  const issues: Issue[] = []
  const budget = promptBudget(input.model)
  if (prompt.length > budget.max) issues.push({ severity: "error", message: `Keep the prompt under ${budget.max} characters.` })
  if (!/vertical 9:16/i.test(prompt)) issues.push({ severity: "error", message: 'Include "vertical 9:16 composition".' })
  if (requested(TEXT_REQUEST, ownPart(prompt))) issues.push({ severity: "error", message: "Don't ask for text, captions, signage, or logos." })
  if (anchor && !prompt.includes(anchor)) issues.push({ severity: "warn", message: "Keep the subject anchor word for word." })
  return issues
}
