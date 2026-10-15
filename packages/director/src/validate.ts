import { jaccard, normalizeText, shingles } from "@vidora/core"
import { DEFAULTS, promptBudget, SPEECH_RATE, targetSeconds, type DirectorInput } from "./context"
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

/** Fixes we can make ourselves, before spending a repair call. Returns a new plan. */
export function autoFix(plan: Plan, input: DirectorInput): Plan {
  const scenes = plan.scenes.map((s) => ({
    ...s,
    prompt: s.prompt.replace(/\s+/g, " ").trim(),
    negative_prompt: input.model.supportsNegativePrompt ? s.negative_prompt.trim() : "",
  }))
  return {
    ...plan,
    scenes,
    voiceover_script: scenes.map((s) => s.voiceover_line.trim()).join(" "),
    hashtags: [...new Set(plan.hashtags.map((h) => h.trim()).filter(Boolean))].slice(0, 10),
    thumbnail_scene_index: Math.min(Math.max(0, plan.thumbnail_scene_index), Math.max(0, scenes.length - 1)),
    title: plan.title.replace(/#\S+/g, "").replace(/\s+/g, " ").trim(),
  }
}

export function validatePlan(plan: Plan, input: DirectorInput, hook: string): Issue[] {
  const issues: Issue[] = []
  const error = (message: string) => issues.push({ severity: "error", message })
  const warn = (message: string) => issues.push({ severity: "warn", message })

  const seconds = targetSeconds(input.brief)
  const lang = (input.brief.language ?? DEFAULTS.language).split("-")[0]!
  const rate = SPEECH_RATE[lang] ?? SPEECH_RATE.en!
  const budget = promptBudget(input.model)
  const allowed = input.model.durations.length ? input.model.durations : [5]
  const scenes = plan.scenes

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

  // Narration fits the time
  const words = (s: string) => normalizeText(s).split(" ").filter(Boolean).length
  const totalWords = words(scenes.map((s) => s.voiceover_line).join(" "))
  const targetWords = total * rate
  if (totalWords > targetWords * 1.2) warn(`The narration has ${totalWords} words; cut it to about ${Math.round(targetWords)} so it fits ${total} s.`)
  if (totalWords < targetWords * 0.45) warn(`The narration has only ${totalWords} words; write about ${Math.round(targetWords * 0.8)} so the video isn't mostly silent.`)

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
    if (p.length > budget.max) error(`${n}: the prompt is ${p.length} characters; this model's limit is ${budget.max}.`)
    if (p.length < budget.min) warn(`${n}: the prompt is only ${p.length} characters; describe the shot in at least ${budget.min}.`)
    if (!/vertical 9:16/i.test(p)) error(`${n}: add "vertical 9:16 composition" to the prompt.`)
    const text = TEXT_REQUEST.exec(p)
    if (text) error(`${n}: the prompt mentions "${text[0]}". Video models can't render text or logos well; show the real thing instead (captions are added later).`)
    const cut = CUT_WORDS.exec(p)
    if (cut) error(`${n}: one prompt is one continuous shot; remove "${cut[0]}".`)
    const move = normalizeText(s.shot.camera_motion).split(" ").filter((w) => w.length > 3).slice(0, 2)
    if (move.length && !move.every((w) => normalizeText(p).includes(w))) warn(`${n}: the prompt should describe its camera move ("${s.shot.camera_motion}").`)
    if (anchor && s.features_anchor && !p.includes(anchor)) error(`${n}: paste the subject_anchor into the prompt word for word.`)
    if (input.model.supportsNegativePrompt && !s.negative_prompt) warn(`${n}: fill in negative_prompt (on-screen text, watermark, distorted hands, flicker …).`)
    if (words(s.voiceover_line) > s.duration_sec * rate * 1.35) warn(`${n}: "${s.voiceover_line}" is too long for ${s.duration_sec} s; shorten it or lengthen the scene.`)
  })

  // Near-identical prompts look like a loop.
  for (let i = 0; i < scenes.length; i++) {
    for (let j = i + 1; j < scenes.length; j++) {
      const a = shingles(scenes[i]!.prompt.replace(anchor, ""))
      const b = shingles(scenes[j]!.prompt.replace(anchor, ""))
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
  if (TEXT_REQUEST.test(prompt)) issues.push({ severity: "error", message: "Don't ask for text, captions, signage, or logos." })
  if (anchor && !prompt.includes(anchor)) issues.push({ severity: "warn", message: "Keep the subject anchor word for word." })
  return issues
}
