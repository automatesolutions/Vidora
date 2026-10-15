import { z } from "zod"
import { createUpload, getDb, UploadRejectedError } from "@vidora/db"
import { getAppSession } from "@/lib/server/session"
import { getStorage } from "@/lib/server/storage"

// Step 1 of an upload: register it and hand the browser a signed PUT URL (5 minutes, exact size and type).
const Body = z.object({ purpose: z.enum(["input", "logo"]), mime: z.string().max(100), bytes: z.number().int().positive() })

export async function POST(req: Request) {
  const s = await getAppSession()
  if (!s) return Response.json({ error: "Sign in again to upload." }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Choose an image to upload." }, { status: 400 })
  try {
    const upload = await createUpload(getDb(), { workspaceId: s.workspaceId, userId: s.userId, ...parsed.data })
    const uploadUrl = await getStorage().presignPut(upload.storageKey, { mime: upload.mime, bytes: upload.bytes })
    return Response.json({ id: upload.id, uploadUrl })
  } catch (err) {
    if (err instanceof UploadRejectedError) return Response.json({ error: err.message }, { status: 400 })
    throw err
  }
}
