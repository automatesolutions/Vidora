import "server-only"
import { secretsFromEnv, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@vidora/core"

// Verifies a request signed by n8n (N8N_TO_VIDORA_SECRET). Returns the raw body on success.
export async function readSignedN8nRequest(req: Request): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
  const body = await req.text()
  const result = verifySignature({
    secrets: secretsFromEnv(process.env.N8N_TO_VIDORA_SECRET),
    rawBody: body,
    signatureHeader: req.headers.get(SIGNATURE_HEADER),
    timestampHeader: req.headers.get(TIMESTAMP_HEADER),
  })
  if (!result.ok) {
    return { ok: false, response: Response.json({ error: "invalid_signature", reason: result.reason }, { status: 401 }) }
  }
  return { ok: true, body }
}

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}
