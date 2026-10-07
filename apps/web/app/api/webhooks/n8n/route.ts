import { CallbackEventSchema } from "@vidora/core"
import { applyCallback, getDb } from "@vidora/db"
import { parseJson, readSignedN8nRequest } from "@/lib/server/n8n"

// Signed status callbacks from n8n (docs/PLAN.md §4.3). Safe to retry: events dedupe on event_id.
export async function POST(req: Request) {
  const signed = await readSignedN8nRequest(req)
  if (!signed.ok) return signed.response
  const parsed = CallbackEventSchema.safeParse(parseJson(signed.body))
  if (!parsed.success) return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 })

  const { outcome, effects } = await applyCallback(getDb(), parsed.data)
  if (outcome === "not_found") return Response.json({ error: "job_not_found" }, { status: 404 })
  // TODO(Phase 1): act on effects (notify_review → email + in-app, notify_failure → alert).
  return Response.json({ ok: true, outcome, duplicate: outcome === "duplicate", effects })
}
