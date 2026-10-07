import { ExecutionFailedSchema } from "@vidora/core"
import { failJobByExecution, getDb } from "@vidora/db"
import { parseJson, readSignedN8nRequest } from "@/lib/server/n8n"

// Called by the n8n `vidora.error` workflow when an execution crashes (docs/PLAN.md §4.6).
export async function POST(req: Request, ctx: RouteContext<"/api/internal/n8n/executions/[executionId]/failed">) {
  const signed = await readSignedN8nRequest(req)
  if (!signed.ok) return signed.response
  const parsed = ExecutionFailedSchema.safeParse(parseJson(signed.body))
  if (!parsed.success) return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 })

  const { executionId } = await ctx.params
  const outcome = await failJobByExecution(getDb(), executionId, parsed.data)
  // 200 even when nothing matched: the error workflow must not retry forever.
  return Response.json({ ok: true, outcome })
}
