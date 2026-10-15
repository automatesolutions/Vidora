import { newId } from "@vidora/core"
import { eq } from "drizzle-orm"
import type { DbOrTx } from "./client"
import { uploads } from "./schema"
import { inWorkspace } from "./scoped"

// Product photos (input) and logos. Browser → storage with a signed PUT, then the server checks the file.
export const UPLOAD_RULES = {
  input: { maxBytes: 15 * 1024 * 1024, mimes: ["image/jpeg", "image/png", "image/webp"] },
  // No SVG: a logo is served back to browsers, and SVG can carry scripts.
  logo: { maxBytes: 2 * 1024 * 1024, mimes: ["image/png", "image/webp", "image/jpeg"] },
} as const
export type UploadPurpose = keyof typeof UPLOAD_RULES

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UploadRejectedError"
  }
}

/** Registers a pending upload. The storage key is ours, never the browser's file name. */
export async function createUpload(
  db: DbOrTx,
  input: { workspaceId: string; userId: string; purpose: UploadPurpose; mime: string; bytes: number }
) {
  const rule = UPLOAD_RULES[input.purpose]
  if (!(rule.mimes as readonly string[]).includes(input.mime)) throw new UploadRejectedError("Use a JPG, PNG, or WebP image.")
  if (!Number.isInteger(input.bytes) || input.bytes <= 0 || input.bytes > rule.maxBytes) {
    throw new UploadRejectedError(`Use an image under ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`)
  }
  const id = newId("upload")
  const [row] = await db
    .insert(uploads)
    .values({
      id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      purpose: input.purpose,
      storageKey: `${input.workspaceId}/uploads/${id}.${EXT[input.mime]}`,
      mime: input.mime,
      bytes: input.bytes,
    })
    .returning()
  return row!
}

export async function getUpload(db: DbOrTx, workspaceId: string, id: string) {
  const [row] = await db.select().from(uploads).where(inWorkspace(uploads, workspaceId, eq(uploads.id, id)))
  return row ?? null
}

export async function setUploadStatus(db: DbOrTx, workspaceId: string, id: string, status: "ready" | "rejected") {
  await db.update(uploads).set({ status }).where(inWorkspace(uploads, workspaceId, eq(uploads.id, id)))
}
