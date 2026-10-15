import { createHash } from "node:crypto"
import { ProviderError } from "@vidora/core"
import type { DownloadedFile } from "./video-provider"

// Downloads a finished output from a public CDN URL: HTTPS only, size-capped, hashed while streaming.
// Never sends credentials.
export async function downloadFile(f: typeof fetch, url: string, maxBytes = 500 * 1024 * 1024): Promise<DownloadedFile> {
  const u = new URL(url)
  if (u.protocol !== "https:") throw new ProviderError("invalid", "Output URL is not HTTPS.")
  let res: Response
  try {
    res = await f(u, { signal: AbortSignal.timeout(10 * 60_000) })
  } catch (err) {
    throw new ProviderError("retry_same", `Download failed: ${String(err)}`)
  }
  if (!res.ok || !res.body) throw new ProviderError(res.status >= 500 || res.status === 429 ? "retry_same" : "invalid", `Download failed (HTTP ${res.status}).`, res.status)
  const declared = Number(res.headers.get("content-length") ?? 0)
  if (declared > maxBytes) throw new ProviderError("invalid", `Output is larger than ${maxBytes} bytes.`)

  const hash = createHash("sha256")
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new ProviderError("invalid", `Output is larger than ${maxBytes} bytes.`)
    }
    hash.update(value)
    chunks.push(value)
  }
  if (total === 0) throw new ProviderError("retry_same", "Downloaded file is empty.")
  const data = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    data.set(c, offset)
    offset += c.byteLength
  }
  return { data, bytes: total, sha256: hash.digest("hex"), contentType: res.headers.get("content-type") ?? "application/octet-stream" }
}
