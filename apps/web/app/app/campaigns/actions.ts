"use server"

import {
  archiveCampaign,
  createCampaign,
  getCampaign,
  getDb,
  pauseCampaign,
  readyUploads,
  runNow,
  setCampaignActive,
  skipNextRun,
} from "@vidora/db"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { NewCampaignSchema, type NewCampaignInput } from "@/lib/campaign-form"
import { canEdit, getAppSession } from "@/lib/server/session"

async function editor() {
  const s = await getAppSession()
  if (!s) redirect("/sign-in")
  if (!canEdit(s)) throw new Error("Only owners, admins, and editors can change campaigns.")
  return s
}

export type CreateResult = { ok: false; message: string; field?: string } | { ok: true }

export async function createCampaignAction(input: NewCampaignInput): Promise<CreateResult> {
  const s = await editor()
  const parsed = NewCampaignSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    return { ok: false, message: issue.message, field: issue.path.join(".") }
  }
  const c = parsed.data
  const db = getDb()
  if (c.product) {
    const ready = await readyUploads(db, s.workspaceId, c.product.imageUploadIds)
    if (ready.length !== c.product.imageUploadIds.length) return { ok: false, message: "One of the product photos didn't finish uploading. Upload it again.", field: "product" }
  }
  const campaign = await createCampaign(db, {
    workspaceId: s.workspaceId,
    createdBy: s.userId,
    name: c.name,
    mode: c.mode,
    brief: {
      topic: c.mode === "product" ? c.topic || `Short videos showing ${c.product!.name}` : c.topic,
      audience: c.audience || undefined,
      tone: c.tone || undefined,
      language: c.language,
      targetLengthSec: c.targetLengthSec,
      cta: c.cta.filter(Boolean),
      hashtagSeeds: c.hashtagSeeds.filter(Boolean),
      bannedTopics: c.bannedTopics.filter(Boolean),
      ...(c.product ? { product: { ...c.product, link: c.product.link || undefined } } : {}),
    },
    schedule: c.schedule,
    publishMode: c.publishMode,
    variationIntensity: c.variationIntensity,
    lockedElements: c.lockedElements,
    perRunCapCredits: c.perRunCapCredits,
    monthlyCapCredits: c.monthlyCapCredits,
    youtubeAccountId: c.youtubeAccountId,
    visibility: c.visibility,
    madeForKids: c.madeForKids,
    activate: true,
  })
  revalidatePath("/app/campaigns")
  redirect(`/app/campaigns/${campaign.id}?created=1`)
}

// ── Campaign controls ─────────────────────────────────────────────────────────

async function owned(campaignId: string) {
  const s = await editor()
  const c = await getCampaign(getDb(), s.workspaceId, campaignId)
  if (!c) throw new Error("Campaign not found")
  return { s, c }
}

export async function pauseAction(campaignId: string) {
  await owned(campaignId)
  await pauseCampaign(getDb(), campaignId, "user")
  revalidatePath(`/app/campaigns/${campaignId}`)
}

export async function resumeAction(campaignId: string) {
  const { s } = await owned(campaignId)
  await setCampaignActive(getDb(), s.workspaceId, campaignId)
  revalidatePath(`/app/campaigns/${campaignId}`)
}

export async function runNowAction(campaignId: string) {
  const { s } = await owned(campaignId)
  await runNow(getDb(), s.workspaceId, campaignId)
  revalidatePath(`/app/campaigns/${campaignId}`)
}

export async function skipNextAction(campaignId: string) {
  const { s } = await owned(campaignId)
  await skipNextRun(getDb(), s.workspaceId, campaignId)
  revalidatePath(`/app/campaigns/${campaignId}`)
}

export async function archiveAction(campaignId: string) {
  const { s } = await owned(campaignId)
  await archiveCampaign(getDb(), s.workspaceId, campaignId)
  revalidatePath("/app/campaigns")
  redirect("/app/campaigns")
}
