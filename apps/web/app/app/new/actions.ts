"use server"

import { BRAND_COLORS_MAX, END_CARD_TEXT_MAX, InsufficientCreditsError, VideoBriefSchema } from "@vidora/core"
import { brandKitForPipeline, createJob, getDb, getUpload, saveBrandKit, updateWorkspaceProfile, UploadRejectedError } from "@vidora/db"
import { z } from "zod"
import { canReview, getAppSession } from "@/lib/server/session"

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; field?: string }

/** "Make video": validates the brief again on the server, reserves credits (or uses the free video), queues the job. */
export async function createVideo(input: unknown, timeZone: string): Promise<ActionResult<{ jobId: string }>> {
  const s = await getAppSession()
  if (!s) return { ok: false, error: "Sign in again to make this video." }
  if (!canReview(s)) return { ok: false, error: "Viewers can't make videos. Ask the workspace owner for access." }
  if (!s.emailVerified) return { ok: false, error: "Confirm your email first. We sent you a link.", field: "email" }

  const parsed = VideoBriefSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: issue?.message ?? "Check your choices and try again.", field: String(issue?.path[0] ?? "") }
  }
  const brief = parsed.data
  const db = getDb()
  if (brief.photo_upload_id) {
    const photo = await getUpload(db, s.workspaceId, brief.photo_upload_id)
    if (!photo || photo.status !== "ready" || photo.purpose !== "input") {
      return { ok: false, error: "Upload the photo again.", field: "photo_upload_id" }
    }
  }

  await updateWorkspaceProfile(db, s.workspaceId, { kind: brief.creator_kind, timeZone })
  const brandKit = brief.use_brand_kit ? await brandKitForPipeline(db, s.workspaceId) : null
  try {
    const job = await createJob(db, { workspaceId: s.workspaceId, brief, brandKit, actor: { type: "user", id: s.userId } })
    return { ok: true, jobId: job.id }
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return { ok: false, error: `This video needs ${err.needed} credits and you have ${err.available}. Pick 8 seconds, or add credits.` }
    }
    throw err
  }
}

const BrandKitInput = z.object({
  logoUploadId: z.string().startsWith("upl_").nullable(),
  colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(BRAND_COLORS_MAX),
  endCardText: z.string().max(END_CARD_TEXT_MAX).nullable(),
})

/** Saves the workspace brand kit (logo, colors, end card text). Used by every later video. */
export async function saveBrandKitAction(input: unknown): Promise<ActionResult> {
  const s = await getAppSession()
  if (!s) return { ok: false, error: "Sign in again to save your brand kit." }
  if (!canReview(s)) return { ok: false, error: "Viewers can't change the brand kit." }
  const parsed = BrandKitInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Use 6-digit hex colors, like #FF4F00, and keep the end card short." }
  try {
    await saveBrandKit(getDb(), s.workspaceId, parsed.data)
    return { ok: true }
  } catch (err) {
    if (err instanceof UploadRejectedError) return { ok: false, error: err.message }
    throw err
  }
}
