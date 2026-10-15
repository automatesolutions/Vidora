import { writeFileSync } from "node:fs"
import { capabilitiesFromSchema, DEFAULT_POOLS, pickVariation, type ModelInputSchema } from "@vidora/core"
import postgres from "postgres"
import { createClaudeCall } from "./claude"
import type { DirectorInput } from "./context"
import { createDirector } from "./director"

// Runs the director agent once on a sample campaign and prints the plan. Costs a few Claude calls,
// nothing on Higgsfield.
//   pnpm --filter @vidora/director try "Daily motivation for students" [model-endpoint-id]
// Needs ANTHROPIC_API_KEY in .env. Reads the model's limits from model_registry when DATABASE_URL is set.

const topic = process.argv[2] ?? "Daily science-backed focus tips for people who work from home"
const modelId = process.argv[3] ?? "kling-video/v3.0/std/text-to-video"

async function loadModel(): Promise<DirectorInput["model"]> {
  const fallback = { id: modelId, displayName: modelId, durations: [3, 4, 5, 6, 7, 8, 9, 10], promptMaxChars: 2500, supportsNegativePrompt: false }
  if (!process.env.DATABASE_URL) return fallback
  const sql = postgres(process.env.DATABASE_URL, { max: 1 })
  try {
    const [row] = await sql<{ id: string; display_name: string; input_schema: ModelInputSchema }[]>`
      select id, display_name, input_schema from model_registry where id = ${modelId}`
    if (!row) return fallback
    const caps = capabilitiesFromSchema(row.input_schema)
    return {
      id: row.id,
      displayName: row.display_name,
      durations: caps.durations.filter((d) => d <= 15),
      promptMaxChars: caps.promptMaxChars,
      supportsNegativePrompt: caps.supportsNegativePrompt,
    }
  } finally {
    await sql.end()
  }
}

const model = await loadModel()
const variation = pickVariation({ pools: DEFAULT_POOLS, locked: {}, history: [], intensity: "high" })
const input: DirectorInput = {
  brief: { campaignName: "Sample campaign", mode: "original", topic, language: "en", targetLengthSec: 30, ctaOptions: ["Follow for more"] },
  variation,
  model,
  history: { hooks: [], titles: [], concepts: [] },
  postDate: new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "Asia/Manila" }).format(new Date()),
}

console.log(`Model: ${model.displayName} · durations ${model.durations.join("/")} s · negative prompt ${model.supportsNegativePrompt ? "yes" : "no"}`)
console.log("This run:", variation, "\n")

const started = Date.now()
const result = await createDirector(createClaudeCall()).planRun(input)
const p = result.plan

console.log(`Hook: ${result.hook}`)
console.log(`Concept: ${p.concept}`)
console.log(`Anchor: ${p.subject_anchor || "(none)"}\n`)
p.scenes.forEach((s, i) => {
  console.log(`── Scene ${i + 1} · ${s.purpose} · ${s.duration_sec}s`)
  console.log(`VO: ${s.voiceover_line}`)
  console.log(`Prompt (${s.prompt.length} chars): ${s.prompt}`)
  if (s.negative_prompt) console.log(`Negative: ${s.negative_prompt}`)
  console.log()
})
console.log(`Title: ${p.title}\nHashtags: ${p.hashtags.join(" ")}\nSelf-check: ${p.self_check}`)
if (result.warnings.length) console.log(`\nWarnings:\n- ${result.warnings.join("\n- ")}`)
const usage = result.calls.reduce((a, c) => ({ in: a.in + c.usage.inputTokens, out: a.out + c.usage.outputTokens, cached: a.cached + c.usage.cacheReadTokens }), { in: 0, out: 0, cached: 0 })
console.log(`\n${result.calls.map((c) => c.step).join(" → ")} · ${usage.in} in / ${usage.out} out / ${usage.cached} cached tokens · ${((Date.now() - started) / 1000).toFixed(0)} s`)
writeFileSync("director-output.json", JSON.stringify(result, null, 2))
console.log("Full result saved to packages/director/director-output.json")
