import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { promisify } from "node:util"
import { buildModelInput, capabilitiesFromSchema, DEFAULT_POOLS, pickVariation, tokenKeysFromEnv, type ModelInputSchema } from "@vidora/core"
import { and, createDb, eq, getModel, ne, readProviderSecret, schema, upsertModels } from "@vidora/db"
import { createClaudeCall, createDirector, type DirectorInput, type Plan } from "@vidora/director"
import { HiggsfieldProvider, type CostEstimate, type VideoProvider } from "@vidora/providers"
import { providerForCredential } from "./providers"
import ffmpegPath from "ffmpeg-static"

// End-to-end test: makes one real Short on your machine, no web app and no sign-in needed.
//   pnpm video:test "Daily focus tips for remote workers"            (asks before spending)
//   pnpm video:test "…" --seconds 15 --model kling-video/v3.0/std/text-to-video --yes
//   --sound   turn on the video model's own generated sound (ambient audio, not narration)
//
// Needs: Connect Higgsfield in the app (plan credits), or a developer API key (HIGGSFIELD_API_KEY in .env).
// Optional: ANTHROPIC_API_KEY (director agent writes the plan; otherwise a basic built-in plan),
//           ELEVENLABS_API_KEY (+ ELEVENLABS_VOICE_ID) for the voiceover.
// Output:   test-videos/<name>/final.mp4, plus the plan, every clip, and state.json.
// Re-running the same command resumes: submitted generations are polled, never paid for twice.

const run = promisify(execFile)
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
// --via plan: your Higgsfield sign-in (plan credits). --via api: the developer API key. Default: plan if connected.
const via = flag("via") ?? "auto"
const [planConnection] = await db
  .select()
  .from(schema.providerCredentials)
  .where(and(eq(schema.providerCredentials.provider, "higgsfield_mcp"), ne(schema.providerCredentials.status, "invalid")))
  .limit(1)
let provider: VideoProvider
let usingPlan = false
if (via !== "api" && planConnection) {
  provider = providerForCredential(db, keys, planConnection)
  usingPlan = true
} else if (via === "plan") {
  throw new Error("No Higgsfield sign-in yet. Open http://localhost:3010/app/connections and press Connect Higgsfield.")
} else {
  const [cred] = await db.select().from(schema.providerCredentials).where(and(eq(schema.providerCredentials.provider, "higgsfield"), ne(schema.providerCredentials.status, "invalid"))).limit(1)
  const apiKey = process.env.HIGGSFIELD_API_KEY?.trim() || (cred ? readProviderSecret(cred, keys) : "")
  if (!apiKey) throw new Error("No Higgsfield connection. Press Connect Higgsfield in Connections, or add HIGGSFIELD_API_KEY to .env.")
  provider = new HiggsfieldProvider({ credentials: apiKey })
}
const check = await provider.verifyCredentials()
if (!check.ok) throw new Error(check.error)
log(usingPlan ? "Using your Higgsfield plan credits (Connect Higgsfield)." : "Using your Higgsfield API key (prepaid API credits).")
if (!state.modelId) {
  state.modelId = usingPlan ? "kling3_0" : "kling-video/v3.0/std/text-to-video"
  save()
}

let model = await getModel(db, state.modelId)
if (!model) {
  log("Reading Higgsfield's model catalog (about 20 s)…")
  if (usingPlan) await upsertModels(db, (await provider.listModels()).map((e) => ({ ...e, provider: "higgsfield_mcp" as const })))
  else await (await import("./models-refresh")).refreshModels(db)
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
    const r = await createDirector(createClaudeCall()).planRun(input)
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
      resolution: "1080p",
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
  log(`\nHiggsfield estimate for ${pending.length} clip(s): ${total.credits.toFixed(1)} ${usingPlan ? "plan credits" : `API credits (about $${total.usd.toFixed(2)})`}.`)
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
await db.close()
const done = state.scenes.filter((s) => s.file)
if (done.length === 0) throw new Error("No clips finished, so there's nothing to assemble.")

// ── 4. Voiceover (ElevenLabs, optional) ─────────────────────────────────────

const ff = ffmpegPath as unknown as string
async function audioSeconds(file: string) {
  const r = await run(ff, ["-i", file, "-f", "null", "-"]).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }))
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

const voice = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb"
for (const [i, s] of plan.scenes.entries()) {
  const out = path.join(outDir, `vo-${i + 1}.mp3`)
  if (!process.env.ELEVENLABS_API_KEY || existsSync(out) || !state.scenes[i]?.file) continue
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ text: s.voiceover_line, model_id: "eleven_multilingual_v2" }),
  })
  if (!res.ok) {
    log(`Voiceover for scene ${i + 1} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`)
    continue
  }
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
}
if (!process.env.ELEVENLABS_API_KEY) log("No ELEVENLABS_API_KEY: the video will be silent (add the key for a voiceover).")

// ── 5. Assemble with FFmpeg: 1080x1920, captions, voice, then join ──────────

const font = ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"].find(existsSync)
if (font) copyFileSync(font, path.join(outDir, "caption-font.ttf"))
const parts: string[] = []
for (const [i, s] of plan.scenes.entries()) {
  const clip = state.scenes[i]?.file
  if (!clip) continue
  const vo = path.join(outDir, `vo-${i + 1}.mp3`)
  const hasVo = existsSync(vo)
  const length = Math.max(s.duration_sec, hasVo ? (await audioSeconds(vo)) + 0.35 : 0)
  const caption = s.caption_words.toUpperCase()
  writeFileSync(path.join(outDir, `cap-${i + 1}.txt`), caption)
  // Bold caps run about 0.62 em wide: shrink long captions so they stay inside 86% of the width.
  const fontSize = Math.min(78, Math.floor((1080 * 0.86) / (Math.max(caption.length, 1) * 0.62)))
  const captions = font
    ? `,drawtext=fontfile=caption-font.ttf:textfile=cap-${i + 1}.txt:expansion=none:fontcolor=white:fontsize=${fontSize}:borderw=7:bordercolor=black:x=(w-text_w)/2:y=h*0.76`
    : ""
  const video = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,tpad=stop_mode=clone:stop_duration=${length}${captions},trim=0:${length.toFixed(2)},setpts=PTS-STARTPTS[v]`
  // Audio: the voiceover, the model's own sound (--sound), both mixed with the voice on top, or silence.
  const fit = `aformat=sample_rates=44100:channel_layouts=stereo,apad,atrim=0:${length.toFixed(2)},asetpts=PTS-STARTPTS`
  const clipHasAudio = nativeAudio && /Audio:/.test((await run(ff, ["-i", clip], { cwd: outDir }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }))).stderr)
  const audio = clipHasAudio && hasVo
    ? `[0:a]volume=0.3,${fit}[n];[1:a]${fit}[vo];[n][vo]amix=inputs=2:duration=longest:normalize=0[a]`
    : clipHasAudio
      ? `[0:a]${fit}[a]`
      : `[1:a]${fit}[a]`
  const part = `part-${i + 1}.mp4`
  await run(
    ff,
    [
      "-y", "-i", clip,
      ...(hasVo ? ["-i", path.basename(vo)] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]),
      "-filter_complex", `${video};${audio}`,
      "-map", "[v]", "-map", "[a]", "-t", length.toFixed(2),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
      part,
    ],
    { cwd: outDir, maxBuffer: 64 * 1024 * 1024 }
  )
  parts.push(part)
}
writeFileSync(path.join(outDir, "parts.txt"), parts.map((p) => `file '${p}'`).join("\n"))
await run(ff, ["-y", "-f", "concat", "-safe", "0", "-i", "parts.txt", "-c", "copy", "-movflags", "+faststart", "final.mp4"], { cwd: outDir })

log(`\nDone: ${path.join(outDir, "final.mp4")}`)
log(`Title: ${plan.title}`)
if (done.length < plan.scenes.length) log(`${plan.scenes.length - done.length} scene(s) failed and were left out.`)

// ── Fallback plan when there's no Claude key ────────────────────────────────

function basicPlan(input: DirectorInput): Plan {
  const style = input.variation.visual_style ?? "cinematic natural light"
  const move = input.variation.camera_language ?? "slow push-in"
  const d = input.model.durations.find((x) => x >= 5) ?? input.model.durations.at(-1) ?? 5
  const shot = (subject: string, action: string, setting: string) =>
    `Medium shot of ${subject}, ${action}, in ${setting}. Soft natural light, ${style}. ${move[0]!.toUpperCase()}${move.slice(1)}. Calm, focused mood, vertical 9:16 composition, subject centered in the upper frame.`
  const scenes: Plan["scenes"] = [
    { purpose: "hook", line: `Here's one idea about ${input.brief.topic.toLowerCase()} you can use today.`, prompt: shot("a person in a light grey sweater", "looking up from a notebook with a small smile", "a sunlit minimalist room with plants") },
    { purpose: "payoff", line: "Start small, keep it simple, and do it every day.", prompt: shot("hands", "placing a ceramic mug on a wooden table as steam rises", "a quiet morning kitchen by a window") },
    { purpose: "cta", line: "Follow for more.", prompt: shot("a window", "with sheer curtains moving gently in the breeze", "a bright apartment at golden hour") },
  ].map((x) => ({
    purpose: x.purpose as "hook" | "payoff" | "cta",
    duration_sec: d,
    voiceover_line: x.line,
    features_anchor: false,
    shot: { shot_type: "medium shot", subject: "", action: "", setting: "", lighting: "soft natural light", camera_motion: move, lens_and_framing: "vertical", style, mood: "calm" },
    prompt: x.prompt,
    negative_prompt: input.model.supportsNegativePrompt ? "text, captions, watermark, logo, distorted hands, blurry, flicker" : "",
    caption_words: x.line.split(" ").slice(0, 4).join(" "),
  }))
  return {
    concept: input.brief.topic,
    angle: "quick tip",
    hook: scenes[0]!.voiceover_line,
    subject_anchor: "",
    continuity: { palette: "soft neutrals", wardrobe_and_props: "", location: "bright home" },
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
