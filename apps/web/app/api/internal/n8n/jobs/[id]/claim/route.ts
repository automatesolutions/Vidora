import { ClaimRequestSchema } from "@vidora/core"
import { claimJob, getDb } from "@vidora/db"
import { parseJson, readSignedN8nRequest } from "@/lib/server/n8n"

// n8n's first step for every run: only one execution may own a job revision (docs/PLAN.md §4.1).
export async function POST(req: Request, ctx: RouteContext<"/api/internal/n8n/jobs/[id]/claim">) {
  const signed = await readSignedN8nRequest(req)
  if (!signed.ok) return signed.response
  const parsed = ClaimRequestSchema.safeParse(parseJson(signed.body))
  if (!parsed.success) return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 })

  const { id } = await ctx.params
  const result = await claimJob(getDb(), id, parsed.data.revision, parsed.data.execution_id)
  if (!result.ok) return Response.json({ error: result.reason }, { status: result.status })
  return Response.json({ ok: true })
}
