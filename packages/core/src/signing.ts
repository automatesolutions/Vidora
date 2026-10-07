import { createHmac, timingSafeEqual } from "node:crypto"

// HMAC-SHA256 webhook signing shared by Vidora ↔ n8n (docs/PLAN.md §4.4).
// Signed string: `${timestamp}.${rawBody}`. Header: `v1=<hex>[,v1=<hex>]` (several during key rotation).
export const SIGNATURE_HEADER = "x-vidora-signature"
export const TIMESTAMP_HEADER = "x-vidora-timestamp"
export const IDEMPOTENCY_HEADER = "idempotency-key"
export const DEFAULT_TOLERANCE_SEC = 300

export function computeSignature(secret: string, timestamp: number | string, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
}

/** Signs with every active secret so the receiver can rotate keys without downtime. */
export function signHeaders(secrets: readonly string[], rawBody: string, now = Date.now()) {
  if (secrets.length === 0) throw new Error("No signing secret configured")
  const ts = Math.floor(now / 1000)
  return {
    [TIMESTAMP_HEADER]: String(ts),
    [SIGNATURE_HEADER]: secrets.map((s) => `v1=${computeSignature(s, ts, rawBody)}`).join(","),
  }
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" }

export function verifySignature(opts: {
  secrets: readonly string[]
  rawBody: string
  signatureHeader: string | null | undefined
  timestampHeader: string | null | undefined
  now?: number
  toleranceSec?: number
}): VerifyResult {
  const { secrets, rawBody, signatureHeader, timestampHeader } = opts
  if (!signatureHeader || !timestampHeader || secrets.length === 0) return { ok: false, reason: "missing" }
  const ts = Number(timestampHeader)
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000)
  if (!Number.isInteger(ts) || Math.abs(nowSec - ts) > (opts.toleranceSec ?? DEFAULT_TOLERANCE_SEC)) {
    return { ok: false, reason: "stale" }
  }
  const given = signatureHeader
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1="))
    .map((p) => Buffer.from(p.slice(3), "hex"))
  for (const secret of secrets) {
    const expected = Buffer.from(computeSignature(secret, ts, rawBody), "hex")
    if (given.some((g) => g.length === expected.length && timingSafeEqual(g, expected))) return { ok: true }
  }
  return { ok: false, reason: "mismatch" }
}

/** Reads comma-separated secrets from an env value, newest first. */
export function secretsFromEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}
