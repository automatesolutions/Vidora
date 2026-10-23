import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import type { z } from "zod"

// One structured Claude call. The director only ever needs "these instructions + this context →
// an object matching this schema", so that's the whole interface; tests swap in a fake.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max"

export type StructuredRequest<T> = {
  schema: z.ZodType<T>
  system: string
  /** Shared per-run context. Sent first and cached, so the ideate and direct calls reuse it. */
  context: string
  instructions: string
  effort: Effort
  maxTokens?: number
  /** Lets Claude read pages on this site (server-side web fetch). Only URLs already in the request can be fetched. */
  webFetch?: { domain: string; maxUses?: number }
}

export type StructuredResult<T> = {
  data: T
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
  model: string // which model actually answered (differs when a refusal fell back)
}

export type StructuredCall = <T>(req: StructuredRequest<T>) => Promise<StructuredResult<T>>

export class DirectorError extends Error {
  constructor(
    readonly kind: "refused" | "truncated" | "unparseable" | "invalid_plan" | "no_fresh_hook" | "source_unreadable" | "api",
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = "DirectorError"
  }
}

export const DEFAULT_DIRECTOR_MODEL = "claude-opus-5-5"

export function createClaudeCall(opts: { client?: Anthropic; model?: string } = {}): StructuredCall {
  const client = opts.client ?? new Anthropic({ maxRetries: 3 })
  const model = opts.model ?? process.env.DIRECTOR_MODEL ?? DEFAULT_DIRECTOR_MODEL

  return async <T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> => {
    let message
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: req.context, cache_control: { type: "ephemeral" } },
          { type: "text", text: req.instructions },
        ],
      },
    ]
    const tools: Anthropic.Beta.BetaToolUnion[] | undefined = req.webFetch
      ? [{ type: "web_fetch_20260209", name: "web_fetch", allowed_domains: [req.webFetch.domain], max_uses: req.webFetch.maxUses ?? 6 }]
      : undefined
    try {
      // A server-tool turn can pause mid-way (pause_turn); sending the partial answer back resumes it.
      for (let turn = 0; turn < 4; turn++) {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: req.maxTokens ?? 32_000,
          // Safety classifiers can decline a request; "default" re-runs it on the model Anthropic
          // recommends for that refusal category instead of failing the run.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          ...(tools ? { tools } : {}),
          messages,
        })
        message = await stream.finalMessage()
        if (message.stop_reason !== "pause_turn") break
        messages.push({ role: "assistant", content: message.content })
      }
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw new DirectorError("api", `Claude API error ${err.status ?? ""}: ${err.message}`, err)
      throw err
    }

    if (!message || message.stop_reason === "pause_turn") throw new DirectorError("truncated", "Reading the page took too many turns.")
    if (message.stop_reason === "refusal") {
      throw new DirectorError("refused", `Claude declined to plan this video (${message.stop_details?.category ?? "no category"}).`, message.stop_details)
    }
    if (message.stop_reason === "max_tokens") throw new DirectorError("truncated", "The plan was cut off before it finished.")
    if (!message.parsed_output) throw new DirectorError("unparseable", "Claude's answer didn't match the plan format.")

    const u = message.usage
    return {
      data: message.parsed_output as T,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
      model: message.model,
    }
  }
}
