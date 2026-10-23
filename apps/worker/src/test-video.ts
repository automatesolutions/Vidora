import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { buildModelInput, capabilitiesFromSchema, DEFAULT_POOLS, pickVariation, tokenKeysFromEnv, type ModelInputSchema } from "@vidora/core"
import { and, createDb, eq, getModel, ne, readProviderSecret, schema } from "@vidora/db"
import { createClaudeCall, createDirector, type DirectorInput, type Plan } from "@vidora/director"
import { HiggsfieldProvider, type CostEstimate, type VideoProvider } from "@vidora/providers"
import { diskCache } from "./audio-assets"
import { renderShort } from "./render"
import { speakExpressive } from "./voice"
import { renderPageText } from "./page-render"
import { engineKeyFromEnv } from "./engine-key"

// End-to-end test: makes one real Short on your machine, no web app and no sign-in needed.
//   pnpm video:test "Daily focus tips for remote workers"            (asks before spending)
//   pnpm video:test "…" --seconds 15 --model kling-video/v3.0/std/text-to-video --yes
//   --sound   turn on the video model's own generated sound (ambient audio, not narration)
//
// Needs: the Higgsfield API key in HF_CREDENTIALS (.env.local). Never uses a Higgsfield plan.
// Optional: ANTHROPIC_API_KEY (director agent writes the plan; otherwise a basic built-in plan),
//           ELEVENLABS_API_KEY for the narrator (eleven_v3), word timings, music and effects.
// --music "<mood>" picks the music bed.
// Output:   test-videos/<name>/final.mp4, plus the plan, every clip, and state.json.
// Re-running the same command resumes: submitted generations are polled, never paid for twice.

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const topic = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "Daily science-backed focus tips for people who work from home"
const seconds = Number(flag("seconds") ?? 15)
const modelId = flag("model") ?? "" // default depends on the connection (see below)
const autoYes = args.includes("--yes")
const nativeAudio = args.includes("--sound")

const slug = `${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/-$/, "")}-${seconds}s${nativeAudio ? "-sound" : ""}`
const outDir = path.resolve(process.cwd(), "../../test-videos", slug)
mkdirSync(outDir, { recursive: true })
const statePath = path.join(outDir, "state.json")

type SceneState = { idempotencyKey: string; input: Record<string, unknown>; requestId?: string; statusUrl?: string; status?: string; file?: string; error?: string }
type State = { plan?: Plan; hook?: string; modelId: string; scenes: SceneState[] }
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { modelId, scenes: [] }
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2))
const log = (...m: unknown[]) => console.log(...m)

// ── 1. Higgsfield key and the model's own schema ────────────────────────────

const db = createDb(process.env.DATABASE_URL, { max: 2 })
const keys = tokenKeysFromEnv(process.env.TOKEN_ENCRYPTION_KEYS)
// Always the Higgsfield API key (prepaid API credits), never a plan sign-in: HF_CREDENTIALS from
// .env.local, else the key the worker saved.
const [cred] = await db.select().from(schema.providerCredentials).where(and(eq(schema.providerCredentials.provider, "higgsfield"), ne(schema.providerCredentials.status, "invalid"))).limit(1)
const apiKey = engineKeyFromEnv() || (cred ? readProviderSecret(cred, keys) : "")
if (!apiKey) throw new Error("No Higgsfield API key. Put it in HF_CREDENTIALS in .env.local (key-id:key-secret).")
const provider: VideoProvider = new HiggsfieldProvider({ credentials: apiKey })
const check = await provider.verifyCredentials()
if (!check.ok) throw new Error(check.error)
log("Using your Higgsfield API key (prepaid API credits).")
if (!state.modelId) {
  state.modelId = "kling-video/v3.0/std/text-to-video"
  save()
}

let model = await getModel(db, state.modelId)
if (!model) {
  log("Reading Higgsfield's model catalog (about 20 s)…")
  await (await import("./models-refresh")).refreshModels(db)
  model = await getModel(db, state.modelId)
}
if (!model) throw new Error(`Unknown model ${state.modelId}. Pick an id from model_registry with --model.`)
const caps = capabilitiesFromSchema(model.inputSchema as ModelInputSchema)
log(`Model: ${model.displayName} · durations ${caps.durations.join("/")} s`)

// ── 2. Plan ─────────────────────────────────────────────────────────────────

if (!state.plan) {
  const variation = pickVariation({ pools: DEFAULT_POOLS, locked: {}, history: [], intensity: "high" })
  const input: DirectorInput = {
    brief: { campaignName: "Test", mode: "original", topic, language: "en", targetLengthSec: seconds, ctaOptions: ["Follow for more"] },
    variation,
    model: { id: model.id, displayName: model.displayName, durations: caps.durations.filter((d) => d <= 15), promptMaxChars: caps.promptMaxChars, supportsNegativePrompt: caps.supportsNegativePrompt },
    history: { hooks: [], titles: [], concepts: [] },
    postDate: new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "Asia/Manila" }).format(new Date()),
  }
  if (process.env.ANTHROPIC_API_KEY) {
    log("Director agent is planning the video (about a minute)…")
    const r = await createDirector(createClaudeCall(), { renderPage: renderPageText }).planRun(input)
    state.plan = r.plan
    state.hook = r.hook
    if (r.warnings.length) log("Plan warnings:\n- " + r.warnings.join("\n- "))
  } else {
    log("No ANTHROPIC_API_KEY: using a basic built-in plan (add the key to see the director agent's prompts).")
    state.plan = basicPlan(input)
    state.hook = state.plan.hook
  }
  writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(state.plan, null, 2))
  save()
}
const plan = state.plan!
plan.scenes.forEach((s, i) => log(`\nScene ${i + 1} (${s.duration_sec}s) VO: ${s.voiceover_line}\n  ${s.prompt}`))

// ── 3. Cost check, then generate (resumable) ────────────────────────────────

if (state.scenes.length === 0) {
  state.scenes = plan.scenes.map((s, i) => ({
    idempotencyKey: `test-${createHash("sha256").update(`${slug}:${i}:${s.prompt}`).digest("hex").slice(0, 32)}`,
    input: buildModelInput(model!.inputSchema as ModelInputSchema, {
      prompt: s.prompt,
      negativePrompt: s.negative_prompt || undefined,
      durationSec: s.duration_sec,
      aspectRatio: "9:16",
      resolution: "720p",
      seed: Math.floor(Math.random() * 1_000_000),
      nativeAudio,
    }),
  }))
  save()
}

const pending = state.scenes.filter((s) => !s.requestId)
if (pending.length) {
  const costs: CostEstimate[] = []
  for (const s of pending) costs.push(await provider.estimateCost(model.id, s.input))
  const total = costs.reduce((a, c) => ({ credits: a.credits + c.credits, usd: a.usd + c.usd }), { credits: 0, usd: 0 })
  log(`\nHiggsfield estimate for ${pending.length} clip(s): ${total.credits.toFixed(1)} API credits (about $${total.usd.toFixed(2)}).`)
  if (!autoYes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = (await rl.question("Generate now and spend these credits? (y/N) ")).trim().toLowerCase()
    rl.close()
    if (answer !== "y" && answer !== "yes") {
      log("Stopped before spending anything. The plan is saved; run the same command again to continue.")
      await db.close()
      process.exit(0)
    }
  }
  for (const s of pending) {
    const sub = await provider.submitGeneration({ modelId: model.id, input: s.input, idempotencyKey: s.idempotencyKey })
    Object.assign(s, { requestId: sub.requestId, statusUrl: sub.statusUrl, status: sub.status })
    save() // saved the moment it's accepted, so a crash here never re-pays
    log(`Submitted scene ${state.scenes.indexOf(s) + 1}: ${sub.requestId}`)
  }
}

log("\nWaiting for Higgsfield (usually 1-5 minutes per clip)…")
const started = Date.now()
while (state.scenes.some((s) => !s.file && !s.error)) {
  for (const [i, s] of state.scenes.entries()) {
    if (s.file || s.error) continue
    const r = await provider.pollStatus({ requestId: s.requestId!, statusUrl: s.statusUrl })
    if (r.status !== s.status) log(`Scene ${i + 1}: ${r.status}`)
    s.status = r.status
    if (r.status === "completed" && r.output) {
      const file = await provider.downloadResult(r.output.url)
      s.file = `scene-${i + 1}.mp4`
      writeFileSync(path.join(outDir, s.file), file.data)
      log(`Scene ${i + 1}: downloaded (${(file.bytes / 1e6).toFixed(1)} MB)`)
    } else if (["failed", "nsfw", "canceled"].includes(r.status)) {
      s.error = r.error ?? r.status
      log(`Scene ${i + 1}: ${r.status}${r.error ? ` (${r.error})` : ""}. Not charged.`)
    }
    save()
  }
  if (state.scenes.some((s) => !s.file && !s.error)) await new Promise((r) => setTimeout(r, Math.min(5000 + (Date.now() - started) / 20, 15000)))
}
const done = state.scenes.filter((s) => s.file)
if (done.length === 0) throw new Error("No clips finished, so there's nothing to assemble.")

// ── 4. Narration, captions, music, effects, FFmpeg (the same render a run uses) ──

const kept = plan.scenes.map((s, i) => ({ s, file: state.scenes[i]?.file })).filter((x) => x.file)
const result = await renderShort({
  workDir: outDir,
  plan: { ...plan, scenes: kept.map((x) => x.s) },
  clips: kept.map((x) => x.file!),
  seed: slug,
  musicMood: flag("music") ?? DEFAULT_POOLS.music_mood[0],
  voices: {
    elevenlabs: (line, voice) => speakExpressive(line, voice),
    lockedElevenLabsVoice: process.env.ELEVENLABS_VOICE_ID,
  },
  audioCache: diskCache(path.resolve(process.cwd(), "../../test-videos/_audio-cache")),
  nativeAudio,
})
await db.close()
log(`Voice: ${JSON.stringify(result.voiceSource)}${result.notes.length ? `\nNotes: ${result.notes.join(" | ")}` : ""}`)

log(`\nDone: ${path.join(outDir, "final.mp4")}`)
log(`Title: ${plan.title}`)
if (done.length < plan.scenes.length) log(`${plan.scenes.length - done.length} scene(s) failed and were left out.`)

// ── Fallback plan when there's no Claude key ────────────────────────────────

function basicPlan(input: DirectorInput): Plan {
  const style = input.variation.visual_style ?? "cinematic natural light"
  const move = input.variation.camera_language ?? "slow push-in"
  const d = input.model.durations.find((x) => x >= 4) ?? input.model.durations.at(-1) ?? 4
  const shot = (subject: string, action: string, setting: string) =>
    `${subject}, already ${action}, in ${setting}. Full-frame cinema camera, 35mm lens, shallow depth of field, ${style}. ${move[0]!.toUpperCase()}${move.slice(1)}, never static. Natural movement, true-to-life skin texture, vertical 9:16 composition, subject in the upper frame.`
  const scenes: Plan["scenes"] = [
    { purpose: "hook", size: "close-up", transition: "none", line: `Here's one idea about ${input.brief.topic.toLowerCase()} you can use today.`, prompt: shot("Close-up of a person in a light grey sweater", "looking up from a notebook with a small smile", "a sunlit minimalist room with plants") },
    { purpose: "payoff", size: "extreme close-up", transition: "whip_pan", line: "Start small, keep it simple, and do it every day.", prompt: shot("Extreme close-up of hands", "placing a ceramic mug on a wooden table as steam rises", "a quiet morning kitchen by a window") },
    { purpose: "cta", size: "wide", transition: "match_cut", line: "Follow for more.", prompt: shot("Wide shot of a window", "with sheer curtains moving gently in the breeze", "a bright apartment at golden hour") },
  ].map((x) => ({
    purpose: x.purpose as "hook" | "payoff" | "cta",
    duration_sec: d,
    transition_in: x.transition as Plan["scenes"][number]["transition_in"],
    voiceover_line: x.line,
    voiceover_performance: x.line,
    features_anchor: false,
    shot: { shot_type: x.size, camera_motion: move, hero_moment: "" },
    prompt: x.prompt,
    negative_prompt: input.model.supportsNegativePrompt ? "text, captions, watermark, logo, distorted hands, blurry, flicker" : "",
    caption_words: x.line.split(" ").slice(0, 4).join(" "),
  }))
  return {
    concept: input.brief.topic,
    angle: "quick tip",
    hook: scenes[0]!.voiceover_line,
    hook_text: "ONE IDEA. TODAY.",
    open_loop: { question: "What is the idea?", planted_in_scene: 0, paid_off_in_scene: 1 },
    loop_ending: "The window light leads back to the notebook.",
    subject_anchor: "",
    narrator: { gender: "female", age: "young" },
    continuity: { palette: "soft neutrals", wardrobe_and_props: "", location: "bright home" },
    look: { lighting: "soft natural light", color_grade: "soft neutrals", style, locks: "" }, // prompts above are already complete
    scenes,
    voiceover_script: scenes.map((s) => s.voiceover_line).join(" "),
    title: input.brief.topic.slice(0, 70),
    description: input.brief.topic,
    hashtags: ["#tips"],
    cta_line: "Follow for more.",
    thumbnail_scene_index: 0,
    self_check: "Built-in test plan.",
  }
}
