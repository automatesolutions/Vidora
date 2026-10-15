"use server"

import { buildDescription, normalizeHashtags, YT_DESCRIPTION_MAX, YT_TITLE_MAX, zonedTimeToUtc } from "@vidora/core"
import { getDb, getRun, getCampaign, setVideoStatus, stepRun } from "@vidora/db"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { canEdit, getAppSession } from "@/lib/server/session"

// The review page's one decision: approve (with any edits) or reject. Approving moves the run to
// "uploading"; the worker then uploads it to YouTube as private with this publish time.

const ReviewSchema = z.object({
  title: z.string().trim().min(1, "Add a title").max(YT_TITLE_MAX, `Keep the title under ${YT_TITLE_MAX + 1} characters`),
  description: z.string().trim().max(YT_DESCRIPTION_MAX - 600, "Shorten the description"),
  hashtags: z.array(z.string().max(100)).max(30),
  postAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time"),
})
export type ReviewInput = z.input<typeof ReviewSchema>
export type ReviewResult = { ok: false; message: string } | undefined

const MIN_LEAD_MS = 15 * 60_000

async function load(runId: string) {
  const s = await getAppSession()
  if (!s) redirect("/sign-in")
  if (!canEdit(s)) return { error: "Only owners, admins, and editors can approve videos." } as const
  const db = getDb()
  const run = await getRun(db, runId)
  if (!run || run.workspaceId !== s.workspaceId) return { error: "We couldn't find that video." } as const
  if (run.status !== "awaiting_approval") return { error: "This video was already approved or rejected." } as const
  return { s, db, run }
}

export async function approveVideo(runId: string, input: ReviewInput): Promise<ReviewResult> {
  const l = await load(runId)
  if ("error" in l) return { ok: false, message: l.error! }
  const parsed = ReviewSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message }
  const { title, description, hashtags, postAt } = parsed.data

  const c = await getCampaign(l.db, l.s.workspaceId, l.run.campaignId)
  const timeZone = c?.schedule.timeZone ?? "Asia/Manila"
  const [date, time] = postAt.split("T") as [string, string]
  const [year, month, day] = date.split("-").map(Number) as [number, number, number]
  const [hour, minute] = time.split(":").map(Number) as [number, number]
  const publishAt = zonedTimeToUtc({ year, month, day, hour, minute }, timeZone)
  if (publishAt.getTime() < Date.now() + MIN_LEAD_MS) return { ok: false, message: "Pick a posting time at least 15 minutes from now." }

  const tags = normalizeHashtags(hashtags)
  await setVideoStatus(l.db, runId, {
    title,
    description: buildDescription(description, tags),
    tags: tags.map((t) => t.slice(1)),
    publishAt,
    approvedBy: l.s.userId,
    approvedAt: new Date(),
  })
  const moved = await stepRun(
    l.db,
    l.run,
    { status: "uploading", nextCheckAt: new Date() },
    { name: "approved", actor: "user", actorId: l.s.userId, payload: { publishAt: publishAt.toISOString(), titleEdited: title !== l.run.plan?.title } }
  )
  if (!moved) return { ok: false, message: "Someone else changed this video at the same time. Reload the page." }
  revalidatePath("/app/approvals")
  redirect(`/app/approvals?approved=${encodeURIComponent(publishAt.toISOString())}`)
}

export async function rejectVideo(runId: string): Promise<ReviewResult> {
  const l = await load(runId)
  if ("error" in l) return { ok: false, message: l.error! }
  await stepRun(l.db, l.run, { status: "canceled", finishedAt: new Date(), errorMessage: "Rejected by you." }, { name: "rejected", actor: "user", actorId: l.s.userId })
  await setVideoStatus(l.db, runId, { status: "failed" })
  revalidatePath("/app/approvals")
  redirect("/app/approvals?rejected=1")
}
