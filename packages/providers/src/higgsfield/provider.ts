import { classifyProviderHttp, parseDecimal, PROVIDER_STATUSES, ProviderError, type ProviderStatus } from "@vidora/core"
import type {
  CatalogEntry,
  CostEstimate,
  DownloadedFile,
  GenerationResult,
  Submission,
  SubmitRequest,
  VideoProvider,
} from "../video-provider"
import { downloadFile } from "../download"
import { fetchHiggsfieldCatalog } from "./catalog"

// Higgsfield API client (docs.higgsfield.ai). Server-side only: it holds the user's key.
//
//   submit   POST /{endpoint}[?hf_webhook=…]   Idempotency-Key header → { request_id, status_url, cancel_url }
//   status   GET  /requests/{id}/status        → { status, video?: {url}, images?: [{url}], audio?, error? }
//   cancel   POST /requests/{id}/cancel        → 202, or 400 once processing started
//   estimate POST /estimate/{endpoint}         → { credits: "1.500", usd: "0.094" }
//
// Auth is `Authorization: Key KEY_ID:KEY_SECRET`. The key is only ever sent to the API host; status
// and cancel URLs from responses are checked against it, and output files are downloaded without it.

type Fetch = typeof fetch

export type HiggsfieldOptions = {
  /** The API key as Higgsfield Console copies it (documented as "KEY_ID:KEY_SECRET"). */
  credentials: string
  baseUrl?: string
  fetch?: Fetch
  /** Per-request timeout for API calls (not downloads). */
  timeoutMs?: number
}

const DEFAULT_BASE = "https://api.higgsfield.ai"
// Any UUID that can't exist: a 404 proves the key works without creating anything.
const PROBE_REQUEST_ID = "00000000-0000-4000-8000-000000000000"
const ENDPOINT_ID = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i
const REQUEST_ID = /^[0-9a-f-]{36}$/i

type RawStatus = {
  status?: string
  request_id?: string
  status_url?: string
  cancel_url?: string
  error?: string | null
  video?: { url?: string; content_type?: string } | null
  images?: { url?: string; content_type?: string }[] | null
  audio?: { url?: string; content_type?: string } | null
  audios?: { url?: string; content_type?: string }[] | null
  payload?: RawStatus | null // webhook envelope nests outputs here
}

export class HiggsfieldProvider implements VideoProvider {
  readonly name = "higgsfield"
  private readonly base: URL
  private readonly f: Fetch
  private readonly timeoutMs: number

  constructor(private readonly opts: HiggsfieldOptions) {
    if (!opts.credentials.trim()) throw new Error("Higgsfield credentials are empty")
    this.base = new URL(opts.baseUrl ?? DEFAULT_BASE)
    this.f = opts.fetch ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 30_000
  }

  // ── VideoProvider ─────────────────────────────────────────────────────────

  listModels(): Promise<CatalogEntry[]> {
    return fetchHiggsfieldCatalog({ fetch: this.f })
  }

  async estimateCost(modelId: string, input: Record<string, unknown>): Promise<CostEstimate> {
    const { body } = await this.call<{ credits?: unknown; usd?: unknown; pricing_description?: unknown }>("POST", this.endpointPath("estimate/" + checkEndpoint(modelId)), { json: input })
    if (body.credits !== undefined || body.usd !== undefined) return { credits: parseDecimal(body.credits), usd: parseDecimal(body.usd) }
    // Some models (Seedance, Wan 3.0) answer with a price description instead of numbers.
    const usd = typeof body.pricing_description === "string" ? priceFromDescription(body.pricing_description, input) : null
    if (usd === null) throw new ProviderError("invalid", `Higgsfield didn't give a price for ${modelId}, so the run won't start without one.`)
    return { credits: Math.round((usd / USD_PER_CREDIT) * 1000) / 1000, usd: Math.round(usd * 1000) / 1000 }
  }

  async submitGeneration(req: SubmitRequest): Promise<Submission> {
    const url = this.endpointPath(checkEndpoint(req.modelId))
    if (req.webhookUrl) {
      if (!req.webhookUrl.startsWith("https://")) throw new Error("Higgsfield webhooks must be HTTPS")
      url.searchParams.set("hf_webhook", req.webhookUrl)
    }
    const { body, correlationId } = await this.call<RawStatus>("POST", url, { json: req.input, idempotencyKey: req.idempotencyKey })
    if (!body.request_id) throw new ProviderError("retry_same", "Higgsfield accepted the request but returned no request ID.", 200, correlationId)
    return {
      requestId: body.request_id,
      status: toProviderStatus(body.status),
      statusUrl: this.trustedUrl(body.status_url) ?? this.endpointPath(`requests/${body.request_id}/status`).toString(),
      cancelUrl: this.trustedUrl(body.cancel_url) ?? this.endpointPath(`requests/${body.request_id}/cancel`).toString(),
      correlationId,
    }
  }

  async pollStatus(ref: { requestId: string; statusUrl?: string | null }): Promise<GenerationResult> {
    const url = this.trustedUrl(ref.statusUrl) ?? this.endpointPath(`requests/${checkRequestId(ref.requestId)}/status`).toString()
    const { body, correlationId } = await this.call<RawStatus>("GET", new URL(url))
    return parseStatus(body, ref.requestId, correlationId)
  }

  downloadResult(url: string, opts: { maxBytes?: number } = {}): Promise<DownloadedFile> {
    // No Authorization header: output URLs are public CDN links, and the key must not leave the API host.
    return downloadFile(this.f, url, opts.maxBytes)
  }

  /** POST /files/generate-upload-url, then PUT the bytes; the public URL goes in image_url. */
  async uploadInput(file: { data: Uint8Array; contentType: string; filename: string }): Promise<string> {
    const { body } = await this.call<{ public_url?: string; upload_url?: string; upload_headers?: Record<string, string> }>("POST", this.endpointPath("files/generate-upload-url"), {
      json: { content_type: file.contentType },
    })
    if (!body.upload_url || !body.public_url) throw new ProviderError("retry_same", "Higgsfield didn't return an upload URL.")
    // The presigned URL is storage, not the API: never send our credentials there.
    const put = await this.f(body.upload_url, { method: "PUT", headers: body.upload_headers ?? { "content-type": file.contentType }, body: new Blob([file.data as BlobPart]) })
    if (!put.ok) throw new ProviderError("retry_same", `Uploading the image failed (HTTP ${put.status}).`)
    return body.public_url
  }

  async cancel(ref: { requestId: string; cancelUrl?: string | null }): Promise<boolean> {
    const url = this.trustedUrl(ref.cancelUrl) ?? this.endpointPath(`requests/${checkRequestId(ref.requestId)}/cancel`).toString()
    try {
      await this.call("POST", new URL(url), { expectEmpty: true })
      return true
    } catch (err) {
      // 400: processing already started, so it can't be canceled any more.
      if (err instanceof ProviderError && err.httpStatus === 400) return false
      throw err
    }
  }

  async verifyCredentials(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.call("GET", this.endpointPath(`requests/${PROBE_REQUEST_ID}/status`))
      return { ok: true } // unexpected, but the key was accepted
    } catch (err) {
      if (err instanceof ProviderError) {
        if (err.httpStatus === 404) return { ok: true } // authenticated; the probe request just doesn't exist
        if (err.kind === "bad_credentials") return { ok: false, error: "Higgsfield didn't accept this key. Copy it again from Higgsfield Console." }
      }
      throw err
    }
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private endpointPath(path: string) {
    return new URL(path.replace(/^\/+/, ""), this.base.toString().replace(/\/?$/, "/"))
  }

  /** Accepts a URL from a Higgsfield response only if it points at the API host. */
  private trustedUrl(url: string | null | undefined): string | null {
    if (!url) return null
    try {
      const u = new URL(url)
      return u.origin === this.base.origin ? u.toString() : null
    } catch {
      return null
    }
  }

  private async call<T>(
    method: "GET" | "POST",
    url: URL,
    opts: { json?: unknown; idempotencyKey?: string; expectEmpty?: boolean } = {}
  ): Promise<{ body: T; correlationId: string | null }> {
    if (url.origin !== this.base.origin) throw new Error("Refusing to send Higgsfield credentials to another host")
    const headers: Record<string, string> = { authorization: `Key ${this.opts.credentials}`, accept: "application/json" }
    if (opts.json !== undefined) headers["content-type"] = "application/json"
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey

    let res: Response
    try {
      res = await this.f(url, {
        method,
        headers,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      // Timeout or network failure: we don't know if it was accepted. Safe to repeat with the same key.
      throw new ProviderError("retry_same", `Couldn't reach Higgsfield (${(err as Error)?.name ?? "network error"}).`)
    }
    const correlationId = res.headers.get("x-correlation-id")
    const text = await res.text().catch(() => "")
    if (!res.ok) {
      const detail = errorDetail(text)
      throw new ProviderError(classifyProviderHttp(res.status, detail), detail || `Higgsfield returned HTTP ${res.status}.`, res.status, correlationId)
    }
    if (opts.expectEmpty || !text) return { body: {} as T, correlationId }
    try {
      return { body: JSON.parse(text) as T, correlationId }
    } catch {
      throw new ProviderError("retry_same", "Higgsfield returned a response we couldn't read.", res.status, correlationId)
    }
  }
}

// ── Parsing ─────────────────────────────────────────────────────────────────

function checkEndpoint(id: string) {
  if (!ENDPOINT_ID.test(id) || id.includes("..")) throw new Error(`Not a Higgsfield endpoint ID: ${id}`)
  return id
}

function checkRequestId(id: string) {
  if (!REQUEST_ID.test(id)) throw new Error(`Not a Higgsfield request ID: ${id}`)
  return id
}

function toProviderStatus(s: unknown): ProviderStatus {
  return (PROVIDER_STATUSES as readonly string[]).includes(String(s)) ? (s as ProviderStatus) : "queued"
}

/** FastAPI envelope: `detail` is a string, or a list of validation errors. */
export function errorDetail(text: string): string {
  try {
    const j = JSON.parse(text) as { detail?: unknown }
    if (typeof j.detail === "string") return j.detail
    if (Array.isArray(j.detail)) {
      return j.detail
        .map((d: { loc?: unknown[]; msg?: string }) => [d.loc?.slice(1).join("."), d.msg].filter(Boolean).join(": "))
        .join("; ")
    }
  } catch {
    // not JSON
  }
  return text.slice(0, 300)
}

/** Status response or webhook envelope → our result shape. */
export function parseStatus(raw: RawStatus, requestId: string, correlationId: string | null = null): GenerationResult {
  const out = raw.payload ?? raw
  const status = toProviderStatus(raw.status)
  const pick = (): GenerationResult["output"] => {
    if (out.video?.url) return { url: out.video.url, kind: "video", contentType: out.video.content_type ?? null }
    const img = out.images?.find((i) => i.url)
    if (img?.url) return { url: img.url, kind: "image", contentType: img.content_type ?? null }
    if (out.audio?.url) return { url: out.audio.url, kind: "audio", contentType: out.audio.content_type ?? null }
    const aud = out.audios?.find((a) => a.url)
    if (aud?.url) return { url: aud.url, kind: "audio", contentType: aud.content_type ?? null }
    return null
  }
  return {
    requestId: raw.request_id ?? requestId,
    status,
    output: status === "completed" ? pick() : null,
    error: raw.error ?? null,
    correlationId,
  }
}

// ── Prices given as text ──────────────────────────────────────────────────────

/** Higgsfield API credits are $0.0625 each (every numeric estimate: e.g. $0.630 = 10.080 credits). */
export const USD_PER_CREDIT = 0.0625

/** Output pixels per resolution for a vertical 9:16 Short (token-metered models price by pixels). */
const FRAME: Record<string, [number, number]> = { "480p": [480, 854], "720p": [720, 1280], "1080p": [1080, 1920] }

/**
 * Dollars for one request, read from a model's `pricing_description` for the requested resolution
 * and duration. Understands the two shapes Higgsfield uses (checked 2026-10-23):
 *   per second: "… $0.2056 per second … at 480p, $0.4622 at 720p …" or "… 480p $0.05, 720p $0.10 …"
 *   per token:  "Each 1,000 video tokens costs $0.0214 at 480p or 720p …", tokens = ceil(s × w × h × 24 / 1024)
 * Null when it can't tell, so the caller refuses rather than guessing.
 */
export function priceFromDescription(description: string, input: Record<string, unknown>): number | null {
  const text = description.replace(/\s+/g, " ")
  const res = typeof input.resolution === "string" ? input.resolution : "720p"
  const seconds = Number(input.duration ?? 5)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const r = res.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const amount = String.raw`\$(\d+(?:\.\d+)?)`

  if (/per (generated )?second/i.test(text)) {
    const perSecond =
      new RegExp(String.raw`${amount}(?: per second[^$,;]*?)? at ${r}\b`, "i").exec(text) ?? new RegExp(String.raw`\b${r} ${amount}`, "i").exec(text)
    if (perSecond) return Number(perSecond[1]) * seconds
  }
  const perThousand = new RegExp(String.raw`1,000 video tokens costs? ${amount} at [^.$]*?\b${r}\b`, "i").exec(text)
  const frame = FRAME[res]
  if (perThousand && frame) {
    const tokens = Math.ceil((seconds * frame[0] * frame[1] * 24) / 1024)
    return (tokens / 1000) * Number(perThousand[1])
  }
  return null
}
