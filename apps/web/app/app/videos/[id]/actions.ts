"use server"

import { getDb, retryGeneration } from "@vidora/db"
import { InsufficientCreditsError, TransitionError } from "@vidora/core"
import { canReview, getAppSession } from "@/lib/server/session"

export async function retryVideo(jobId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getAppSession()
  if (!s) return { ok: false, error: "Sign in again to retry." }
  if (!canReview(s)) return { ok: false, error: "Viewers can't retry videos." }
  try {
    await retryGeneration(getDb(), { workspaceId: s.workspaceId, jobId, actor: { type: "user", id: s.userId } })
    return { ok: true }
  } catch (err) {
    if (err instanceof InsufficientCreditsError) return { ok: false, error: err.message }
    if (err instanceof TransitionError) return { ok: false, error: "This video is already running again." }
    throw err
  }
}
