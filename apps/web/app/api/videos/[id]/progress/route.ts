import { getDb, getProgress } from "@vidora/db"
import { getAppSession } from "@/lib/server/session"

// Polled by the progress page (every 2 s while visible). We poll instead of using server-sent events:
// Neon's pooled connections can't LISTEN/NOTIFY, so a stream would poll the database anyway, while holding
// a Cloud Run request open for the whole job. The ETag makes an unchanged poll a cheap 304.
export async function GET(req: Request, ctx: RouteContext<"/api/videos/[id]/progress">) {
  const s = await getAppSession()
  if (!s) return Response.json({ error: "signed_out" }, { status: 401 })
  const { id } = await ctx.params
  const after = new URL(req.url).searchParams.get("after")
  const p = await getProgress(getDb(), s.workspaceId, id, after)
  if (!p) return Response.json({ error: "not_found" }, { status: 404 })

  const etag = `"${p.job.version}-${p.job.revision}-${p.events.at(-1)?.id ?? after ?? "0"}-${p.job.progress}"`
  const headers = { etag, "cache-control": "private, no-cache" }
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers })
  return Response.json(p, { headers })
}
