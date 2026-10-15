import { isTerminalGeneration, ProviderError, seal, type TokenKey } from "@vidora/core"
import {
  deferCheck,
  getGenerationJob,
  getModel,
  getProviderCredentialById,
  markCredentialChecked,
  recordCredentialLost,
  recordDownloadError,
  recordProviderStatus,
  recordStored,
  recordSubmitError,
  recordSubmitted,
  type Db,
  type GenerationJob,
  type ProviderCredential,
} from "@vidora/db"
import type { VideoProvider } from "@vidora/providers"
import type { Storage } from "@vidora/storage"
import { log } from "./log"

// Moves one generation job forward by one step. Called by the BullMQ worker for every due row.
// Every outcome is written to the row before returning, so the next call (after a crash, on another
// worker, after a restart) continues from exactly where this one stopped:
//   pending      → submit (same idempotency key every time: never pays twice)
//   submitted /
//   in_progress  → read status
//   completed    → download the output into our storage

export type EngineDeps = {
  db: Db
  storage: Pick<Storage, "put">
  tokenKeys: readonly TokenKey[]
  /** Builds the provider for one stored credential (API key or plan sign-in). Injected so tests can fake Higgsfield. */
  providerFor: (credential: ProviderCredential) => VideoProvider
  webhook?: { baseUrl: string; secret: string } | null
}

const EXT: Record<string, string> = { video: "mp4", image: "png", audio: "wav" }

export async function advanceGeneration(deps: EngineDeps, id: string): Promise<GenerationJob | null> {
  const job = await getGenerationJob(deps.db, id)
  if (!job || isTerminalGeneration(job.status)) return job

  const credential = job.credentialId ? await getProviderCredentialById(deps.db, job.credentialId) : null
  if (!credential) return recordCredentialLost(deps.db, job, "The Higgsfield key was removed.")
  const provider = deps.providerFor(credential)

  try {
    switch (job.status) {
      case "pending":
        return await submit(deps, provider, job)
      case "submitted":
      case "in_progress":
        return await poll(deps, provider, job)
      case "completed":
        return await download(deps, provider, job)
    }
  } catch (err) {
    if (err instanceof ProviderError && err.kind === "bad_credentials") {
      await markCredentialChecked(deps.db, credential.id, { ok: false, error: err.message })
      return recordCredentialLost(deps.db, job, err.message)
    }
    throw err
  }
  return job
}

async function submit(deps: EngineDeps, provider: VideoProvider, job: GenerationJob) {
  const model = await getModel(deps.db, job.modelId)
  try {
    const sub = await provider.submitGeneration({
      modelId: job.modelId,
      input: job.input,
      idempotencyKey: job.idempotencyKey,
      webhookUrl: webhookUrl(deps, job),
    })
    log.info("generation submitted", { id: job.id, model: job.modelId, requestId: sub.requestId, replay: job.submitAttempts > 0 })
    return recordSubmitted(deps.db, job, { ...sub, providerStatus: sub.status, timeoutSec: model?.timeoutSec })
  } catch (err) {
    if (!(err instanceof ProviderError) || err.kind === "bad_credentials") throw err
    log.warn("generation submit failed", { id: job.id, kind: err.kind, status: err.httpStatus, error: err.message, correlationId: err.correlationId })
    return recordSubmitError(deps.db, job, { kind: err.kind, message: err.message, correlationId: err.correlationId })
  }
}

async function poll(deps: EngineDeps, provider: VideoProvider, job: GenerationJob) {
  try {
    const r = await provider.pollStatus({ requestId: job.requestId!, statusUrl: job.statusUrl })
    const row = await recordProviderStatus(deps.db, job, {
      providerStatus: r.status,
      outputUrl: r.output?.url ?? null,
      outputKind: r.output?.kind ?? null,
      error: r.error,
    })
    if (row && row.status !== job.status) log.info("generation status", { id: job.id, from: job.status, to: row.status })
    return row
  } catch (err) {
    if (!(err instanceof ProviderError) || err.kind === "bad_credentials") throw err
    // Status reads are always safe to repeat. 404 means the request ID is unknown to this key.
    if (err.httpStatus === 404) return recordCredentialLost(deps.db, job, "Higgsfield doesn't know this request. Was the API key changed?")
    return deferCheck(deps.db, job, 15_000, err.message)
  }
}

async function download(deps: EngineDeps, provider: VideoProvider, job: GenerationJob) {
  try {
    const file = await provider.downloadResult(job.outputUrl!)
    const ext = EXT[job.outputKind ?? "video"] ?? "bin"
    const storageKey = `${job.workspaceId}/generations/${job.id}.${ext}`
    await deps.storage.put(storageKey, file.data, file.contentType)
    log.info("generation stored", { id: job.id, bytes: file.bytes })
    return recordStored(deps.db, job, { storageKey, bytes: file.bytes, sha256: file.sha256 })
  } catch (err) {
    log.warn("generation download failed", { id: job.id, error: String(err) })
    return recordDownloadError(deps.db, job, err instanceof Error ? err.message : String(err))
  }
}

/** HTTPS webhook URL with a signed token naming this job, or null (dev without a public URL). */
function webhookUrl(deps: EngineDeps, job: GenerationJob): string | null {
  const w = deps.webhook
  if (!w?.secret || !w.baseUrl.startsWith("https://")) return null
  // The token must stay identical across re-submits: Higgsfield's idempotency treats a changed webhook
  // URL as a different request. So: no expiry-dependent content beyond a fixed long TTL from creation.
  const token = seal({ g: job.id }, w.secret, 30 * 86_400, job.createdAt.getTime())
  return `${w.baseUrl}/api/webhooks/higgsfield/${job.id}?t=${encodeURIComponent(token)}`
}
