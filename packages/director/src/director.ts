import { HOOK_SIMILARITY_LIMIT, maxSimilarity, normalizeText } from "@vidora/core"
import type { StructuredCall, StructuredResult } from "./claude"
import { DirectorError } from "./claude"
import { promptBudget, renderContext, type DirectorInput } from "./context"
import { DIRECTOR_SYSTEM, directInstructions, IDEATE_INSTRUCTIONS, MODERATION_SYSTEM, moderationInstructions, repairInstructions } from "./prompts"
import { IdeationSchema, PlanSchema, RewriteSchema, type Ideation, type Plan } from "./schemas"
import { assemble, autoFix, validatePlan, validatePrompt, type Issue } from "./validate"

// The director agent. For one run of a campaign:
//   1. ideate  → 8 hook candidates (Claude)
//   2. pick    → the freshest hook vs. this campaign's history (code)
//   3. direct  → full shot plan with one Higgsfield prompt per scene (Claude)
//   4. check   → deterministic rules (code); up to 2 repair rounds with the exact issues (Claude)
// Plus rewriteForModeration(), used once when Higgsfield rejects a prompt as nsfw.

export type DirectorResult = {
  hook: string
  plan: Plan
  ideation: Ideation
  warnings: string[] // soft issues that survived the repairs
  calls: { step: "ideate" | "direct" | "repair"; model: string; usage: StructuredResult<unknown>["usage"] }[]
}

const MAX_REPAIRS = 2

export function createDirector(call: StructuredCall) {
  async function ideate(input: DirectorInput, context: string, extra = "") {
    return call({ schema: IdeationSchema, system: DIRECTOR_SYSTEM, context, instructions: IDEATE_INSTRUCTIONS + extra, effort: "low", maxTokens: 8_000 })
  }

  /** The hook least like anything used before; null if every candidate is too close. Prefers this run's angle. */
  function pickHook(ideation: Ideation, input: DirectorInput): string | null {
    const used = input.history.hooks
    const angle = normalizeText(input.variation.script_angle ?? "")
    const scored = ideation.hooks
      .map((h) => ({ text: h.text.trim(), similarity: maxSimilarity(h.text, used), onAngle: !!angle && normalizeText(h.angle).includes(angle) }))
      .filter((h) => h.text && h.similarity < HOOK_SIMILARITY_LIMIT)
      // Also skip candidates that are near-duplicates of each other's best, keeping order stable.
      .sort((a, b) => Number(b.onAngle) - Number(a.onAngle) || a.similarity - b.similarity)
    return scored[0]?.text ?? null
  }

  async function planRun(input: DirectorInput): Promise<DirectorResult> {
    const context = renderContext(input)
    const calls: DirectorResult["calls"] = []

    let idea = await ideate(input, context)
    calls.push({ step: "ideate", model: idea.model, usage: idea.usage })
    let hook = pickHook(idea.data, input)
    if (!hook) {
      idea = await ideate(input, context, "\n\nYour previous hooks were all too close to ones already used. Go further: pick sub-topics and examples none of the recent videos touched.")
      calls.push({ step: "ideate", model: idea.model, usage: idea.usage })
      hook = pickHook(idea.data, input)
    }
    if (!hook) throw new DirectorError("no_fresh_hook", "Couldn't find a hook that's different enough from recent videos.")

    let res = await call({ schema: PlanSchema, system: DIRECTOR_SYSTEM, context, instructions: directInstructions(hook), effort: "medium", maxTokens: 16_000 })
    calls.push({ step: "direct", model: res.model, usage: res.usage })
    let plan = autoFix(res.data, input)
    let issues = validatePlan(plan, input, hook)

    for (let round = 0; round < MAX_REPAIRS && issues.length > 0; round++) {
      // Fresh single-turn call with the plan inlined: nothing to replay, and the context stays cached.
      res = await call({
        schema: PlanSchema,
        system: DIRECTOR_SYSTEM,
        context,
        instructions: `${directInstructions(hook)}\n\nYour plan:\n<plan>${JSON.stringify(plan)}</plan>\n\n${repairInstructions(issues.map((i) => i.message))}`,
        effort: "medium",
        maxTokens: 16_000,
      })
      calls.push({ step: "repair", model: res.model, usage: res.usage })
      const repaired = autoFix(res.data, input)
      const repairedIssues = validatePlan(repaired, input, hook)
      // Keep whichever version is better: fewer errors first, then fewer warnings.
      if (score(repairedIssues) <= score(issues)) {
        plan = repaired
        issues = repairedIssues
      }
    }

    const errors = issues.filter((i) => i.severity === "error")
    if (errors.length) throw new DirectorError("invalid_plan", `The plan still breaks ${errors.length} rule(s) after ${MAX_REPAIRS} repairs.`, errors)
    // Repairs work on the scene-only prompts; Higgsfield gets them with the shared look appended.
    return { hook, plan: assemble(plan), ideation: idea.data, warnings: issues.map((i) => i.message), calls }
  }

  /** One rewrite of a prompt Higgsfield's moderation rejected (spec: rewrite and retry once). */
  async function rewriteForModeration(input: Pick<DirectorInput, "model">, scene: { prompt: string; negativePrompt: string; voiceoverLine: string }, subjectAnchor: string) {
    const max = promptBudget(input.model).max
    const res = await call({
      schema: RewriteSchema,
      system: MODERATION_SYSTEM,
      context: "Rewrite one rejected text-to-video prompt.",
      instructions: moderationInstructions({ ...scene, subjectAnchor, maxChars: max }),
      effort: "medium",
      maxTokens: 8_000,
    })
    const issues = validatePrompt(res.data.prompt, input, subjectAnchor)
    if (issues.some((i) => i.severity === "error")) throw new DirectorError("invalid_plan", "The rewritten prompt still breaks the prompt rules.", issues)
    return { ...res.data, negative_prompt: res.data.negative_prompt.trim() }
  }

  return { planRun, pickHook, rewriteForModeration }
}

const score = (issues: Issue[]) => issues.filter((i) => i.severity === "error").length * 100 + issues.length
export type Director = ReturnType<typeof createDirector>
