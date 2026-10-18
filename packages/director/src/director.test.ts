import { DEFAULT_POOLS, maxSimilarity, pickVariation, variationHash, type Variation } from "@vidora/core"
import { describe, expect, it } from "vitest"
import type { StructuredCall, StructuredRequest } from "./claude"
import { DirectorError } from "./claude"
import { renderContext, type DirectorInput } from "./context"
import { createDirector } from "./director"
import type { Ideation, Plan } from "./schemas"
import { autoFix, validatePlan } from "./validate"

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ANCHOR = "a woman in her early 30s with shoulder-length black hair and a rust-orange knit sweater"
const HOOK = "Your brain quits at 3 PM for a reason nobody told you."

const input: DirectorInput = {
  brief: {
    campaignName: "Focus tips",
    mode: "original",
    topic: "Daily science-backed focus and productivity tips for remote workers",
    audience: "remote workers aged 22-40",
    tone: "calm, smart, encouraging",
    language: "en",
    targetLengthSec: 30,
    ctaOptions: ["Follow for a new focus tip every day"],
    bannedTopics: ["caffeine pills"],
  },
  variation: { script_angle: "common mistake and the fix", visual_style: "warm golden-hour tones, gentle lens flare, soft haze", camera_language: "slow push-in", pacing: "steady and measured" },
  model: { id: "kling-video/v3.0/std/text-to-video", displayName: "Kling 3.0 — Standard · Text to video", durations: [3, 4, 5, 6, 7, 8, 9, 10], promptMaxChars: 2500, supportsNegativePrompt: false },
  history: { hooks: ["Stop checking your phone first thing in the morning."], titles: ["The 2-minute rule"], concepts: ["Phone-free mornings"] },
  postDate: "Friday, 16 October 2026",
}

const shot = (camera = "slow push-in") => ({ shot_type: "medium close-up", camera_motion: camera, hero_moment: "she SHUTS the laptop at 2.0s" })

// A scene prompt in the labeled-section format (prompts.ts). The shared look is appended by assemble().
const prompt = (subject: string, firstFrame: string, action: string) =>
  [
    "SHOT: One continuous medium close-up.",
    `SUBJECT: ${subject}.`,
    "LOCATION: a bright apartment home office; foreground a tidy oak desk with a ceramic mug, background a tall window over rooftops.",
    `FIRST FRAME: ${firstFrame}`,
    "OPTICS: 47° field of view, shallow depth of field, focus on her eyes.",
    "CAMERA: slow push-in of about 20 cm over the whole shot, upright and level.",
    `ACTION: ${action}`,
    "PERFORMANCE: restrained and human, a held breath before the change.",
    "PHYSICS: real weight and contact shadows, nothing floats.",
    "AUDIO: room tone and soft diegetic sounds only. NO MUSIC, NO speech.",
  ].join(" ")

const LOOK: Plan["look"] = {
  lighting: "Window key from frame-left, warm and low, camera on the shadow side, faint haze, WB locked 4800K.",
  color_grade: "Warm oak and amber neutrals, one rust accent on the sweater.",
  style: "Warm golden-hour tones with gentle lens flare, photorealistic live action, visible pores, fine film grain, NOT a 3D render, no plastic skin.",
  locks: "identity matches the description exactly; one continuous shot; nothing in frame reads as lettering or a logo; natural hands with five fingers",
}

function goodPlan(): Plan {
  const scenes: Plan["scenes"] = [
    { purpose: "hook", duration_sec: 5, voiceover_line: `${HOOK}`, features_anchor: true, shot: shot(), prompt: prompt(ANCHOR, "she is already slumping toward the laptop screen, one hand rubbing her eyes.", "0.0-2.0s: her shoulders sink lower. 2.0-3.5s: her forehead DROPS onto her folded arms. 3.5-5.0s: a long, heavy exhale."), negative_prompt: "", caption_words: "3 PM crash" },
    { purpose: "build", duration_sec: 8, voiceover_line: "Your focus runs in cycles of about ninety minutes, and most of us push straight through the dip.", features_anchor: true, shot: shot(), prompt: prompt(`seen from overhead, ${ANCHOR}`, "her hands are already drifting from the keyboard toward a cooling mug among scattered notes.", "0.0-3.0s: fingers hover over the keys, unsure. 3.0-5.5s: she PUSHES the mug aside and steam thins out. 5.5-8.0s: her hand returns to the keyboard and stalls."), negative_prompt: "", caption_words: "90-minute cycles" },
    { purpose: "payoff", duration_sec: 10, voiceover_line: "Instead, stand up, walk to a window, and look at something far away for two minutes. Your attention resets faster than any scroll break.", features_anchor: true, shot: shot("slow push-in"), prompt: prompt(ANCHOR, "she is already standing at the tall window, seen from behind her shoulder, clouds drifting over the rooftops.", "0.0-4.0s: she rolls her shoulders back. 4.0-6.0s: she LIFTS her gaze to the far horizon. 6.0-10.0s: her breathing slows and her hands loosen at her sides."), negative_prompt: "", caption_words: "Look far away" },
    { purpose: "cta", duration_sec: 5, voiceover_line: "Follow for a new focus tip every day.", features_anchor: false, shot: shot(), prompt: prompt("a ceramic mug of tea on a sunlit oak windowsill", "steam is already curling upward as a breeze moves a sheer curtain.", "0.0-2.0s: steam rises in a thin ribbon. 2.0-3.5s: the curtain BILLOWS and the steam swirls. 3.5-5.0s: the air settles and steam straightens."), negative_prompt: "", caption_words: "Daily focus tips" },
  ]
  return {
    concept: "The afternoon slump is a natural focus cycle, and a two-minute far-gaze break resets it.",
    angle: "common mistake and the fix",
    hook: HOOK,
    subject_anchor: ANCHOR,
    narrator: { gender: "female", age: "young" },
    continuity: { palette: "warm amber and oak", wardrobe_and_props: "rust-orange knit sweater, ceramic mug", location: "bright apartment home office" },
    look: LOOK,
    scenes,
    voiceover_script: scenes.map((s) => s.voiceover_line).join(" "),
    title: "Why your focus crashes at 3 PM (and the 2-minute fix)",
    description: "Your attention runs in cycles. Here's a simple reset for the afternoon dip.",
    hashtags: ["#focus", "#productivity", "#remotework"],
    cta_line: "Follow for a new focus tip every day.",
    thumbnail_scene_index: 2,
    self_check: "All rules followed.",
  }
}

const ideation: Ideation = {
  hooks: [
    { text: "Stop checking your phone first thing in the morning!", angle: "myth versus truth", visual_idea: "phone on nightstand" },
    { text: HOOK, angle: "common mistake and the fix", visual_idea: "tired worker at 3 PM" },
    { text: "Two minutes at a window beats a coffee.", angle: "surprising fact", visual_idea: "window view" },
  ],
}

/** Fake Claude: answers from a queue per schema type and records every request. */
function fakeCall(answers: { ideate?: Ideation[]; plans?: Plan[] }) {
  const requests: StructuredRequest<unknown>[] = []
  const ideas = [...(answers.ideate ?? [])]
  const plans = [...(answers.plans ?? [])]
  const call: StructuredCall = async <T>(req: StructuredRequest<T>) => {
    requests.push(req as StructuredRequest<unknown>)
    const isPlan = "scenes" in ((req.schema as unknown as { shape?: object }).shape ?? {})
    const data = (isPlan ? plans.shift() : ideas.shift()) as T
    if (!data) throw new Error("fake ran out of answers")
    return { data, model: "claude-opus-5-5", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
  }
  return { call, requests }
}

// ── Variation engine ─────────────────────────────────────────────────────────

describe("variation engine", () => {
  const pools = { ...DEFAULT_POOLS, model: ["kling", "seedance", "wan"] }
  let seed = 1
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

  it("keeps locked elements and changes the right number of axes", () => {
    const last: Variation = { visual_style: DEFAULT_POOLS.visual_style[0]!, camera_language: DEFAULT_POOLS.camera_language[0]!, pacing: DEFAULT_POOLS.pacing[0]!, script_angle: DEFAULT_POOLS.script_angle[0]!, caption_style: DEFAULT_POOLS.caption_style[0]!, music_mood: DEFAULT_POOLS.music_mood[0]!, model: "kling" }
    const low = pickVariation({ pools, locked: { model: "kling" }, history: [last], intensity: "low", random })
    expect(low.model).toBe("kling")
    const changed = Object.keys(last).filter((k) => low[k] !== last[k])
    expect(changed.length).toBe(2)
    const high = pickVariation({ pools, locked: { model: "kling" }, history: [last], intensity: "high", random })
    expect(Object.keys(last).filter((k) => k !== "model" && high[k] === last[k])).toEqual([])
  })

  it("never repeats a recent combination and prefers options not used lately", () => {
    const history: Variation[] = []
    for (let i = 0; i < 40; i++) history.unshift(pickVariation({ pools, locked: {}, history, intensity: "medium", random }))
    const keys = history.map((v) => JSON.stringify(Object.entries(v).sort()))
    for (let i = 0; i < keys.length; i++) expect(keys.slice(i + 1, i + 30)).not.toContain(keys[i])
    // Over 40 runs every visual style shows up.
    expect(new Set(history.map((v) => v.visual_style)).size).toBe(DEFAULT_POOLS.visual_style.length)
  })

  it("fingerprints production choices plus the hook", () => {
    const v = { visual_style: "a", model: "b" }
    expect(variationHash(v, "Hello there")).toBe(variationHash({ model: "b", visual_style: "a" }, "hello, there!"))
    expect(variationHash(v, "Hello there")).not.toBe(variationHash(v, "Goodbye there"))
  })

  it("measures hook similarity", () => {
    expect(maxSimilarity("Stop checking your phone first thing in the morning", ["Stop checking your phone first thing in the morning!"])).toBe(1)
    expect(maxSimilarity("Two minutes at a window beats a coffee", ["Stop checking your phone first thing in the morning"])).toBeLessThan(0.1)
  })
})

// ── Validator ────────────────────────────────────────────────────────────────

describe("plan validator", () => {
  it("accepts a good plan", () => {
    expect(validatePlan(autoFix(goodPlan(), input), input, HOOK)).toEqual([])
  })

  it("flags the problems that waste a generation", () => {
    const p = goodPlan()
    p.scenes[0]!.duration_sec = 12 // not allowed by this model
    p.scenes[1]!.prompt += " A neon sign that says FOCUS hangs above."
    p.scenes[2]!.prompt = p.scenes[2]!.prompt.replace(ANCHOR, "a woman") // anchor dropped
    p.scenes[3]!.prompt += " Then cut to a sunset."
    p.voiceover_script = "x"
    p.description = "Unlike caffeine pills, this works."
    const errors = validatePlan(autoFix(p, input), input, HOOK).filter((i) => i.severity === "error").map((i) => i.message)
    expect(errors.join("\n")).toMatch(/Scene 1: duration 12 s isn't allowed/)
    expect(errors.join("\n")).toMatch(/Scene 2: the prompt mentions "sign that says"/)
    expect(errors.join("\n")).toMatch(/Scene 3: paste the subject_anchor/)
    expect(errors.join("\n")).toMatch(/Scene 4: one prompt is one continuous shot/)
    expect(errors.join("\n")).toMatch(/caffeine pills/)
  })

  it("trims a repeated shared look out of a scene prompt", () => {
    const p = goodPlan()
    p.scenes[0]!.prompt += " LIGHTING: harsh noon sun. STYLE: glossy."
    expect(autoFix(p, input).scenes[0]!.prompt).not.toContain("harsh noon sun")
  })

  it("treats negated mentions as locks, not requests", () => {
    const p = goodPlan()
    p.scenes[0]!.prompt += " NO logos, no on-screen text, no cuts, no montage."
    expect(validatePlan(autoFix(p, input), input, HOOK)).toEqual([])
  })

  it("warns when a prompt is a flat paragraph instead of labeled sections", () => {
    const p = goodPlan()
    p.scenes[1]!.prompt = `Overhead shot of ${ANCHOR} at a desk, pushing a mug aside. Warm light. Slow push-in. Vertical 9:16 composition. ` + "Soft afternoon haze. ".repeat(50)
    expect(validatePlan(autoFix(p, input), input, HOOK).map((i) => i.message).join("\n")).toMatch(/Scene 2: write the prompt as labeled sections; it's missing SHOT:/)
  })

  it("requires the hook as the first spoken words", () => {
    const p = goodPlan()
    p.scenes[0]!.voiceover_line = "Hey everyone! " + HOOK
    expect(validatePlan(autoFix(p, input), input, HOOK).map((i) => i.message)).toContain("Scene 1's voiceover_line must start with the hook, word for word.")
  })

  it("auto-fixes what it can without another call", () => {
    const p = goodPlan()
    p.voiceover_script = "wrong"
    p.title = "Focus tip #shorts"
    p.thumbnail_scene_index = 9
    p.scenes[0]!.negative_prompt = "blurry" // model has no negative prompt
    const fixed = autoFix(p, input)
    expect(fixed.voiceover_script.startsWith(HOOK)).toBe(true)
    expect(fixed.title).toBe("Focus tip")
    expect(fixed.thumbnail_scene_index).toBe(3)
    expect(fixed.scenes[0]!.negative_prompt).toBe("")
  })

  it("warns when the narration can't fit the time", () => {
    const p = goodPlan()
    p.scenes[1]!.voiceover_line = "word ".repeat(80)
    expect(validatePlan(autoFix(p, input), input, HOOK).some((i) => i.severity === "warn" && /too long/.test(i.message))).toBe(true)
  })
})

// ── Agent loop ───────────────────────────────────────────────────────────────

describe("director agent", () => {
  it("renders the run context with the model's limits and the history", () => {
    const ctx = renderContext(input)
    expect(ctx).toContain("Allowed scene durations in seconds: 3, 4, 5, 6, 7, 8, 9, 10")
    expect(ctx).toContain("Negative prompt: not supported")
    expect(ctx).toContain("Script angle: common mistake and the fix")
    expect(ctx).toContain("- Stop checking your phone first thing in the morning.")
    expect(ctx).toContain("about 75 words")
  })

  it("skips used hooks, prefers the run's angle, and returns a valid plan in two calls", async () => {
    const { call, requests } = fakeCall({ ideate: [ideation], plans: [goodPlan()] })
    const result = await createDirector(call).planRun(input)
    expect(result.hook).toBe(HOOK)
    expect(result.warnings).toEqual([])
    expect(requests).toHaveLength(2)
    // Same system and context on both calls, so the second one reads the cache.
    expect(requests[1]!.context).toBe(requests[0]!.context)
    expect(requests[1]!.instructions).toContain(HOOK)
  })

  it("sends the exact issues back for repair and keeps the better plan", async () => {
    const broken = goodPlan()
    broken.scenes[2]!.prompt = broken.scenes[2]!.prompt.replace(ANCHOR, "a woman")
    const { call, requests } = fakeCall({ ideate: [ideation], plans: [broken, goodPlan()] })
    const result = await createDirector(call).planRun(input)
    expect(requests).toHaveLength(3)
    expect(requests[2]!.instructions).toContain("Scene 3: paste the subject_anchor into the prompt word for word.")
    // The repair saw scene-only prompts; the result carries the shared look and framing.
    expect(requests[2]!.instructions).not.toContain("WB locked 4800K. COLOR GRADE")
    expect(result.plan.scenes[2]!.prompt).toContain(ANCHOR)
    expect(result.plan.scenes[2]!.prompt).toContain("WB locked 4800K")
    expect(result.plan.scenes[2]!.prompt).toContain("vertical 9:16 composition")
    expect(result.plan.scenes[2]!.prompt).toContain("NO ONE SPEAKS")
  })

  it("fails the run when errors survive every repair", async () => {
    const broken = goodPlan()
    broken.scenes[0]!.duration_sec = 30
    const { call } = fakeCall({ ideate: [ideation], plans: [broken, broken, broken] })
    const err = await createDirector(call).planRun(input).catch((e) => e)
    expect(err).toBeInstanceOf(DirectorError)
    expect(err.kind).toBe("invalid_plan")
  })

  it("asks for new hooks when every candidate was used before, then gives up", async () => {
    const stale: Ideation = { hooks: [{ text: "Stop checking your phone first thing in the morning", angle: "x", visual_idea: "y" }] }
    const { call, requests } = fakeCall({ ideate: [stale, stale] })
    const err = await createDirector(call).planRun(input).catch((e) => e)
    expect(err.kind).toBe("no_fresh_hook")
    expect(requests[1]!.instructions).toMatch(/too close to ones already used/)
  })
})
