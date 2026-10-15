import { unseal } from "@vidora/core"
import { eq, expediteGenerationCheck, getDb, schema } from "@vidora/db"

// Higgsfield calls this when a generation reaches completed, failed, or nsfw (`hf_webhook`).
// Deliveries aren't signed, so the URL carries our own signed token naming the job, and the payload is
// treated as a hint only: we move the job's next status check to now, and the worker reads the real
// result from Higgsfield with the user's key. Duplicates are expected and acknowledged.

const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"])

export async function POST(req: Request, ctx: RouteContext<"/api/webhooks/higgsfield/[id]">) {
  const { id } = await ctx.params
  const secret = process.env.HIGGSFIELD_WEBHOOK_SECRET
  const token = new URL(req.url).searchParams.get("t") ?? ""
  // A token minted when the job was created stays valid for 30 days (see the worker's webhookUrl).
  const sealed = secret ? unseal<{ g: string }>(token, secret) : null
  if (!sealed || sealed.g !== id) return new Response("Not found", { status: 404 })

  const body = (await req.json().catch(() => null)) as { request_id?: unknown; status?: unknown } | null
  const requestId = typeof body?.request_id === "string" ? body.request_id : null
  const status = typeof body?.status === "string" ? body.status : null
  // 4xx is permanent for Higgsfield (no retries), which is right for a body that isn't theirs.
  if (!requestId || !status || !TERMINAL.has(status)) return new Response("Bad envelope", { status: 400 })

  const db = getDb()
  const eventId = `${requestId}:${status}`
  const inserted = await db
    .insert(schema.webhookEvents)
    .values({ eventId, source: "higgsfield" })
    .onConflictDoNothing()
    .returning({ eventId: schema.webhookEvents.eventId })
  if (inserted.length === 0) return new Response(null, { status: 204 }) // duplicate delivery

  const expedited = await expediteGenerationCheck(db, id, requestId)
  await db
    .update(schema.webhookEvents)
    .set({ processedAt: new Date(), outcome: expedited ? "check_now" : "ignored" })
    .where(eq(schema.webhookEvents.eventId, eventId))
  return new Response(null, { status: 204 })
}

