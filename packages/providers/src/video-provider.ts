import type { ModelInputSchema, ProviderStatus } from "@vidora/core"

// The generic video provider interface. Higgsfield is the first implementation; anything else
// (a self-hosted model, another API) plugs in behind the same six calls.

/** One model endpoint as the provider documents it. Saved to `model_registry`. */
export type CatalogEntry = {
  id: string // endpoint ID, e.g. "kling-video/v3.0/std/text-to-video"
  family: string
  displayName: string
  workflow: string // "text-to-video", "image-to-video", ...
  outputKind: "video" | "image" | "audio"
  inputSchema: ModelInputSchema
  docsUrl: string
}

export type CostEstimate = { credits: number; usd: number }

export type SubmitRequest = {
  modelId: string
  input: Record<string, unknown>
  /** Same key for every retry of the same intended generation; a new key means a new (paid) generation. */
  idempotencyKey: string
  /** HTTPS URL the provider calls when the request finishes. Polling still runs as the fallback. */
  webhookUrl?: string | null
}

export type Submission = {
  requestId: string
  status: ProviderStatus
  statusUrl: string
  cancelUrl: string | null
  correlationId: string | null
}

export type GenerationResult = {
  requestId: string
  status: ProviderStatus
  /** The main output file, when completed. */
  output: { url: string; kind: "video" | "image" | "audio"; contentType: string | null } | null
  error: string | null
  correlationId: string | null
}

export type DownloadedFile = { data: Uint8Array; bytes: number; sha256: string; contentType: string }

export interface VideoProvider {
  readonly name: string
  /** Models this provider documents (refreshes the registry). */
  listModels(): Promise<CatalogEntry[]>
  /** What one generation with these parameters would cost. */
  estimateCost(modelId: string, input: Record<string, unknown>): Promise<CostEstimate>
  submitGeneration(req: SubmitRequest): Promise<Submission>
  pollStatus(ref: { requestId: string; statusUrl?: string | null }): Promise<GenerationResult>
  downloadResult(url: string, opts?: { maxBytes?: number }): Promise<DownloadedFile>
  /** True if canceled; false if it already started (no longer cancelable). */
  cancel(ref: { requestId: string; cancelUrl?: string | null }): Promise<boolean>
  /**
   * Uploads an input image (product photo) and returns the value to put in the request's
   * `image_url`. Providers that take media by ID return a "media:<id>" reference instead.
   */
  uploadInput?(file: { data: Uint8Array; contentType: string; filename: string }): Promise<string>
  /** Checks the API key without spending anything. */
  verifyCredentials(): Promise<{ ok: true } | { ok: false; error: string }>
}
