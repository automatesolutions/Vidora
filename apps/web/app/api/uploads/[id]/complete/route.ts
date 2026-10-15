import { getDb, getUpload, setUploadStatus } from "@vidora/db"
import { sniffImageType } from "@vidora/storage"
import { getAppSession } from "@/lib/server/session"
import { getStorage } from "@/lib/server/storage"

// Step 2 of an upload: check what actually landed (size and real file type), then mark it ready.
export async function POST(_req: Request, ctx: RouteContext<"/api/uploads/[id]/complete">) {
  const s = await getAppSession()
  if (!s) return Response.json({ error: "Sign in again to upload." }, { status: 401 })
  const { id } = await ctx.params
  const db = getDb()
  const upload = await getUpload(db, s.workspaceId, id)
  if (!upload) return Response.json({ error: "We couldn't find that upload. Try again." }, { status: 404 })
  if (upload.status === "ready") return Response.json({ id, status: "ready", previewUrl: await getStorage().presignGet(upload.storageKey) })

  const found = await getStorage().inspect(upload.storageKey)
  const sniffed = found ? sniffImageType(found.head) : null
  if (!found || found.bytes !== upload.bytes || sniffed !== upload.mime) {
    await setUploadStatus(db, s.workspaceId, id, "rejected")
    return Response.json({ error: "That file isn't a JPG, PNG, or WebP image. Choose another one." }, { status: 400 })
  }
  await setUploadStatus(db, s.workspaceId, id, "ready")
  return Response.json({ id, status: "ready", previewUrl: await getStorage().presignGet(upload.storageKey) })
}
