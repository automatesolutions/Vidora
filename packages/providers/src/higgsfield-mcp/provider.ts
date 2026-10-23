import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { PROVIDER_STATUSES, ProviderError, type ModelInputSchema, type ProviderStatus } from "@vidora/core"
import { downloadFile } from "../download"
import type { CatalogEntry, CostEstimate, DownloadedFile, GenerationResult, Submission, SubmitRequest, VideoProvider } from "../video-provider"
import { HF_MCP_URL } from "./oauth"

// Higgsfield through the account's MCP connection ("Connect Higgsfield"): generations are paid with
// the account's plan credits. Same six calls as the API provider, built on Higgsfield's MCP tools:
//   generate_video_batch (submit) · jobs_wait (status) · generate_video + get_cost (estimate)
//   models_explore (catalog) · balance (credentials check)
// Unlike the API there's no idempotency key, so a submit whose outcome is unknown (network drop after
// sending) is never repeated automatically: it fails as "unknown_submit" for a person to check.

type Fetch = typeof fetch

export type HiggsfieldMcpOptions = {
  /** Returns a valid access token, refreshing and saving it when needed. */
  accessToken: () => Promise<string>
  fetch?: Fetch
  url?: string
}

type JobRow = { index?: number; job_id?: string; status?: string; result_url?: string; type?: string; error?: string; preset_recommendation?: { preset_id?: string } }

export class HiggsfieldMcpProvider implements VideoProvider {
  readonly name = "higgsfield_mcp"
  private readonly f: Fetch

  constructor(private readonly opts: HiggsfieldMcpOptions) {
    this.f = opts.fetch ?? fetch
  }

  // ── VideoProvider ─────────────────────────────────────────────────────────

  async listModels(): Promise<CatalogEntry[]> {
    const ids: string[] = []
    let after: string | undefined
    for (let page = 0; page < 10; page++) {
      const r = await this.tool<{ items?: { id: string }[]; models?: { id: string }[]; next_page_token?: string }>("models_explore", {
        action: "list",
        type: "video",
        limit: 100,
        ...(after ? { after } : {}),
      })
      for (const m of r.items ?? r.models ?? []) ids.push(m.id)
      if (!r.next_page_token) break
      after = r.next_page_token
    }
    const entries: CatalogEntry[] = []
    for (const id of ids) {
      const m = await this.tool<McpModel>("models_explore", { action: "get", model_id: id }).catch(() => null)
      if (m && m.output_type === "video") entries.push(catalogEntry(m))
    }
    return entries
  }

  async estimateCost(modelId: string, input: Record<string, unknown>): Promise<CostEstimate> {
    const r = await this.generation<{ cost?: { credits?: number; credits_exact?: number } }>("generate_video", (declined) => ({
      params: { model: modelId, ...toMcpParams(input), get_cost: true, ...(declined ? { declined_preset_id: declined } : {}) },
      context: "Cost estimate for a scheduled AutoShorts Studio video.",
    }))
    const credits = r.cost?.credits_exact ?? r.cost?.credits
    if (typeof credits !== "number") throw new ProviderError("retry_same", "Higgsfield didn't return a cost estimate.")
    // Plan credits have no dollar price we can read; spend caps use credits for this provider.
    return { credits, usd: 0 }
  }

  async submitGeneration(req: SubmitRequest): Promise<Submission> {
    let result: { jobs?: JobRow[] }
    try {
      result = await this.generation<{ jobs?: JobRow[] }>("generate_video_batch", (declined) => ({
        requests: [{ index: 0, params: { model: req.modelId, ...toMcpParams(req.input), count: 1, ...(declined ? { declined_preset_id: declined } : {}) } }],
        context: "Scene clip for a scheduled AutoShorts Studio video.",
      }))
    } catch (err) {
      if (err instanceof ProviderError && err.kind !== "retry_same") throw err
      // We may or may not have created (and paid for) a job. Don't guess: stop and let a person look.
      throw new ProviderError("invalid", `Couldn't confirm whether Higgsfield started this clip (${(err as Error).message}). Check your Higgsfield history before retrying.`)
    }
    const job = result.jobs?.[0]
    if (!job?.job_id) throw new ProviderError("invalid", job?.error ?? "Higgsfield didn't start the clip.")
    return { requestId: job.job_id, status: mapStatus(job.status), statusUrl: "", cancelUrl: null, correlationId: null }
  }

  async pollStatus(ref: { requestId: string }): Promise<GenerationResult> {
    const r = await this.tool<{ jobs?: JobRow[] }>("jobs_wait", { jobs: [{ index: 0, job_id: ref.requestId }], timeout_seconds: 0 })
    const job = r.jobs?.[0]
    if (!job) throw new ProviderError("retry_same", "Higgsfield didn't return the clip's status.")
    const status = mapStatus(job.status)
    return {
      requestId: ref.requestId,
      status,
      output: status === "completed" && job.result_url ? { url: job.result_url, kind: kindOf(job), contentType: null } : null,
      error: job.error ?? null,
      correlationId: null,
    }
  }

  downloadResult(url: string, opts: { maxBytes?: number } = {}): Promise<DownloadedFile> {
    return downloadFile(this.f, url, opts.maxBytes)
  }

  /** media_upload → PUT the bytes → media_confirm. Returns "media:<id>" for submitGeneration to turn into start_image. */
  async uploadInput(file: { data: Uint8Array; contentType: string; filename: string }): Promise<string> {
    const r = await this.tool<{ uploads?: { upload_url?: string; media_id?: string; content_type?: string }[] }>("media_upload", {
      filename: file.filename,
      content_type: file.contentType,
    })
    const u = r.uploads?.[0]
    if (!u?.upload_url || !u.media_id) throw new ProviderError("retry_same", "Higgsfield didn't return an upload slot.")
    // The URL is signed for content-type and if-none-match (write once).
    const put = await this.f(u.upload_url, { method: "PUT", headers: { "content-type": u.content_type ?? file.contentType, "if-none-match": "*" }, body: new Blob([file.data as BlobPart]) })
    if (!put.ok) throw new ProviderError("retry_same", `Uploading the image to Higgsfield failed (HTTP ${put.status}).`)
    await this.tool("media_confirm", { media_id: u.media_id, type: "image" })
    return `media:${u.media_id}`
  }

  async cancel(): Promise<boolean> {
    return false // the MCP tools have no cancel
  }

  async verifyCredentials(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.balance()
      return { ok: true }
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "bad_credentials") return { ok: false, error: "The Higgsfield sign-in expired. Connect Higgsfield again." }
      throw err
    }
  }

  /** Plan credits and plan name, straight from Higgsfield. */
  async balance(): Promise<{ credits: number; plan: string | null }> {
    const r = await this.tool<{ credits?: number; subscription_plan_type?: string }>("balance", {})
    return { credits: Number(r.credits ?? 0), plan: r.subscription_plan_type ?? null }
  }

  /**
   * Narration with ElevenLabs v4 on the account's plan credits (about half a credit per line).
   * `text` may carry v4 audio tags such as "[excited]" or "[whispers]"; they steer the delivery and
   * aren't spoken. Waits for the audio (a few seconds) and returns the mp3.
   */
  async speak(text: string, voiceId: string, opts: { model?: string; timeoutMs?: number } = {}): Promise<Uint8Array> {
    const plain = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim()
    const r = await this.tool<{ results?: { id?: string; status?: string; error?: string }[] }>("generate_audio", {
      params: { model: opts.model ?? "elevenlabs_v4", prompt: plain, dialogue: [{ text, voice_type: "preset", voice_id: voiceId }] },
      context: "Voiceover line for a scheduled AutoShorts Studio video.",
    })
    const jobId = r.results?.[0]?.id
    if (!jobId) throw new ProviderError("invalid", r.results?.[0]?.error ?? "Higgsfield didn't start the voiceover.")
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000)
    while (Date.now() < deadline) {
      const w = await this.tool<{ jobs?: JobRow[] }>("jobs_wait", { jobs: [{ index: 0, job_id: jobId }], timeout_seconds: 15 })
      const job = w.jobs?.[0]
      const status = mapStatus(job?.status)
      if (status === "completed" && job?.result_url) return (await downloadFile(this.f, job.result_url, 20 * 1024 * 1024)).data
      if (status === "failed" || status === "nsfw" || status === "canceled") throw new ProviderError("invalid", job?.error ?? `The voiceover ${status}.`)
    }
    throw new ProviderError("retry_same", "The Higgsfield voiceover took too long.")
  }

  // ── MCP plumbing ──────────────────────────────────────────────────────────

  /** A generation call that declines Higgsfield's preset suggestions: we always want our prompt as written. */
  private async generation<T>(name: string, args: (declinedPreset?: string) => Record<string, unknown>): Promise<T> {
    let declined: string | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      let r: T & { notice?: { type?: string; data?: { retry_literal_with?: { declined_preset_id?: string } } }; jobs?: JobRow[] }
      let fromError: string | undefined
      try {
        r = await this.tool(name, args(declined))
      } catch (err) {
        // When every item in a batch is held back for a preset suggestion, the tool returns an error
        // that names the preset to decline ("… declined_preset_id=<uuid>"). Nothing was submitted.
        fromError = err instanceof ProviderError ? /declined_preset_id=([0-9a-f-]{36})/i.exec(err.message)?.[1] : undefined
        if (!fromError || fromError === declined) throw err
        declined = fromError
        continue
      }
      const fromNotice = r.notice?.type === "preset_recommendation" ? r.notice.data?.retry_literal_with?.declined_preset_id : undefined
      const fromJob = r.jobs?.find((j) => j.status === "submission_failed" && j.preset_recommendation?.preset_id)?.preset_recommendation?.preset_id
      const next = fromNotice ?? fromJob
      if (!next || next === declined) return r
      declined = next
    }
    throw new ProviderError("invalid", "Higgsfield kept suggesting a preset instead of running the prompt.")
  }

  private async tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const token = await this.opts.accessToken()
    const transport = new StreamableHTTPClientTransport(new URL(this.opts.url ?? HF_MCP_URL), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: this.f,
    })
    const client = new Client({ name: "autoshorts-studio", version: "0.1.0" })
    try {
      await client.connect(transport)
      const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 })
      const text = (res.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? ""
      if (res.isError) throw new ProviderError(/credit/i.test(text) ? "no_credits" : "invalid", text.slice(0, 300) || `Higgsfield's ${name} tool failed.`)
      if (res.structuredContent) return res.structuredContent as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new ProviderError("retry_same", `Higgsfield's ${name} tool returned something we couldn't read.`)
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err
      const message = err instanceof Error ? err.message : String(err)
      if (/401|unauthori[sz]ed|invalid_token/i.test(message)) throw new ProviderError("bad_credentials", "The Higgsfield sign-in expired. Connect Higgsfield again.")
      throw new ProviderError("retry_same", `Couldn't reach Higgsfield (${message.slice(0, 120)}).`)
    } finally {
      await client.close().catch(() => {})
    }
  }
}

// ── Mapping ───────────────────────────────────────────────────────────────────

type McpModel = {
  id: string
  name: string
  provider_name?: string
  description?: string
  output_type: string
  parameters?: { name: string; type?: string; min?: number; max?: number; default?: unknown; options?: (string | number)[] }[]
  medias?: { name: string; type: string; roles?: string[] }[]
  aspect_ratios?: string[]
}

/** Turns an MCP model description into the JSON schema shape the rest of the app reads. */
export function catalogEntry(m: McpModel): CatalogEntry {
  const properties: ModelInputSchema["properties"] = { prompt: { type: "string" } }
  for (const p of m.parameters ?? []) {
    if (p.name === "duration" && p.min !== undefined && p.max !== undefined && !p.options) {
      properties.duration = { type: "integer", minimum: p.min, maximum: p.max, default: p.default }
    } else {
      properties[p.name] = { type: p.type === "number" ? "number" : "string", ...(p.options ? { enum: p.options } : {}), ...(p.default !== undefined ? { default: p.default } : {}) }
    }
  }
  if (m.aspect_ratios?.length) properties.aspect_ratio = { type: "string", enum: m.aspect_ratios }
  // Models that take a start frame accept our image_url (a "media:<id>" reference, see toMcpParams).
  if (m.medias?.some((x) => x.type === "image" && x.roles?.includes("start_image"))) properties.image_url = { type: "string" }
  return {
    id: m.id,
    family: (m.provider_name ?? m.id).toLowerCase(),
    displayName: m.name,
    workflow: "text-to-video",
    outputKind: "video",
    inputSchema: { type: "object", required: [], properties },
    docsUrl: "https://higgsfield.ai",
  }
}

/** Our generic input → MCP params: an uploaded image ("media:<id>") becomes the start frame. */
export function toMcpParams(input: Record<string, unknown>): Record<string, unknown> {
  const { image_url, ...rest } = input
  if (typeof image_url === "string" && image_url.startsWith("media:")) {
    return { ...rest, medias: [{ role: "start_image", value: image_url.slice("media:".length) }] }
  }
  return image_url === undefined ? rest : { ...rest, image_url }
}

function mapStatus(s: string | undefined): ProviderStatus {
  if (s === "pending" || s === "queued") return "queued"
  if ((PROVIDER_STATUSES as readonly string[]).includes(String(s))) return s as ProviderStatus
  if (s === "submission_failed" || s === "error") return "failed"
  return "queued"
}

function kindOf(job: JobRow): "video" | "image" | "audio" {
  if (/\.(mp4|mov|webm)(\?|$)/i.test(job.result_url ?? "") || job.type === "video") return "video"
  return job.type === "audio" ? "audio" : "image"
}
