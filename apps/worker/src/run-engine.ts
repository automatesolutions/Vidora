import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  buildDescription,
  buildModelInput,
  capabilitiesFromSchema,
  checkBudget,
  DEFAULT_POOLS,
  monthStart,
  normalizeHashtags,
  pickVariation,
  retryDecision,
  type ModelInputSchema,
  type TokenKey,
  type Variation,
} from "@vidora/core"
import {
  activeVideoCredential,
  campaignHistory,
  campaignSpend,
  createGenerationJob,
  generationJobsForRun,
  getActiveAccount,
  getCampaignWithSchedule,
  getModel,
  getRun,
  notify,
  pauseCampaign,
  readyUploads,
  recentVariations,
  recordRunFailure,
  recordRunSuccess,
  saveFingerprint,
  schema,
  setVideoStatus,
  stepRun,
  upsertModels,
  upsertVideoForRun,
  eq,
  type Campaign,
  type ConnectedAccount,
  type Db,
  type GenerationJob,
  type ProviderCredential,
  type Run,
  type RunPlan,
} from "@vidora/db"
import { DirectorError, type Director, type DirectorInput } from "@vidora/director"
import type { VideoProvider } from "@vidora/providers"
import { assembleShort, grabFrame } from "./assemble"
import { log } from "./log"
import { DEFAULT_VOICES, type VoiceResult } from "./voice"
import type { PublishOutcome } from "./youtube"

// The run engine: takes one booked run from "planned" to a scheduled YouTube post. Each call does
// one step and saves the result; `nextCheckAt` says when to come back. A crash or restart resumes
// from the saved status. Scene generations themselves are driven by the generation engine.
//
//   planned     → claim, pick the variation, director plan, budget check, start scene generations
//   generating  → wait for scenes; retry failed ones (2x, moderation rewrite once)
//   assembling  → voiceover + FFmpeg → final video in storage → Video Library
//   awaiting_approval (approval mode) → a person approves → uploading
//   uploading   → YouTube upload as private with publishAt
//   scheduled   → published once the slot passes

export type RunDeps = {
  db: Db
  storage: { put(key: string, body: Uint8Array | string, mime: string): Promise<void>; getBytes(key: string): Promise<Uint8Array> }
  tokenKeys: readonly TokenKey[]
  providerFor: (credential: ProviderCredential) => VideoProvider
  /** Null when there's no ANTHROPIC_API_KEY: runs then fail with a clear message. */
  director: () => Director | null
  speak: (text: string, voiceId: string) => Promise<VoiceResult>
  publish: (input: {
    workspaceId: string
    videoId: string
    account: ConnectedAccount
    video: Uint8Array
    cover: Uint8Array | null
    title: string
    description: string
    tags: string[]
    madeForKids: boolean
    publishAt: Date
  }) => Promise<PublishOutcome>
  workRoot: string
  now?: () => Date
}

const SCENE_CHECK_MS = 15_000
const PLANNING_LEASE_MS = 20 * 60_000 // a crashed planning step is picked up again after this
const DEFAULT_MODEL = { higgsfield_mcp: "kling3_0", higgsfield: "kling-video/v3.0/std/text-to-video" } as const
const LOW_BALANCE_CREDITS = 20

export async function advanceRun(deps: RunDeps, runId: string): Promise<Run | null> {
  const run = await getRun(deps.db, runId)
  if (!run) return null
  switch (run.status) {
    case "planned":
      return plan(deps, run)
    case "generating":
      return run.plan ? watchScenes(deps, run) : plan(deps, run) // plan missing: planning crashed, redo it
    case "assembling":
      return assemble(deps, run)
    case "uploading":
      return upload(deps, run)
    case "scheduled":
      return markPublished(deps, run)
    default:
      return run
  }
}

// ── planned → generating ──────────────────────────────────────────────────────

async function plan(deps: RunDeps, original: Run) {
  const now = deps.now?.() ?? new Date()
  // Claim first (planning takes a minute or two), so a second worker doesn't plan the same run.
  const run =
    original.status === "planned"
      ? await stepRun(deps.db, original, { status: "generating", startedAt: now, nextCheckAt: new Date(now.getTime() + PLANNING_LEASE_MS) }, { name: "started" })
      : await stepRun(deps.db, original, { nextCheckAt: new Date(now.getTime() + PLANNING_LEASE_MS) })
  if (!run) return null

  const c = await getCampaignWithSchedule(deps.db, run.campaignId)
  if (!c) return fail(deps, run, "no_campaign", "The campaign was deleted.")
  const { campaign, schedule } = c

  const credential = await activeVideoCredential(deps.db, run.workspaceId)
  if (!credential) {
    await pauseCampaign(deps.db, campaign.id, "bad_credentials", "Connect Higgsfield in Connections.")
    return fail(deps, run, "no_provider", "Higgsfield isn't connected. Open Connections and press Connect Higgsfield.")
  }
  const director = deps.director()
  if (!director) return fail(deps, run, "no_director", "The director agent needs ANTHROPIC_API_KEY in .env to plan videos.")
  const provider = deps.providerFor(credential)

  // Model: the campaign's choice, else the default for this connection.
  const modelId = campaign.modelPrefs.allowed?.[0] ?? DEFAULT_MODEL[credential.provider]
  let model = await getModel(deps.db, modelId)
  if (!model && credential.provider === "higgsfield_mcp") {
    await upsertModels(deps.db, (await provider.listModels()).map((e) => ({ ...e, provider: "higgsfield_mcp" as const })))
    model = await getModel(deps.db, modelId)
  }
  if (!model) return fail(deps, run, "no_model", `Model ${modelId} isn't in the registry. Run pnpm models:refresh.`)
  const caps = capabilitiesFromSchema(model.inputSchema as ModelInputSchema)

  // Variation: rotate production choices, keep locked ones.
  const locked: Record<string, string> = {}
  for (const el of campaign.lockedElements) if (campaign.lockedValues[el]) locked[el] = campaign.lockedValues[el]!
  const variation: Variation = pickVariation({
    pools: { ...DEFAULT_POOLS, voice: DEFAULT_VOICES, ...(campaign.brief.cta?.length ? { cta: campaign.brief.cta } : {}) },
    locked,
    history: await recentVariations(deps.db, campaign.id),
    intensity: campaign.variationIntensity,
  })

  // A locked element without a value yet keeps what this (first) run picked from now on.
  const newLocks = campaign.lockedElements.filter((el) => !campaign.lockedValues[el] && variation[el])
  if (newLocks.length) {
    await deps.db
      .update(schema.campaigns)
      .set({ lockedValues: { ...campaign.lockedValues, ...Object.fromEntries(newLocks.map((el) => [el, variation[el]!])) } })
      .where(eq(schema.campaigns.id, campaign.id))
  }

  // Product photos → the provider's storage (once per run).
  const product = campaign.mode === "product" ? campaign.brief.product : undefined
  let photoRefs: string[] = []
  if (product) {
    const photos = await readyUploads(deps.db, run.workspaceId, product.imageUploadIds)
    if (photos.length === 0) return fail(deps, run, "no_photos", "This product campaign has no photos. Add at least one.")
    if (!provider.uploadInput) return fail(deps, run, "no_image_upload", "This Higgsfield connection can't take product photos.")
    for (const [i, ph] of photos.entries()) {
      const data = await deps.storage.getBytes(ph.storageKey)
      photoRefs.push(await provider.uploadInput({ data, contentType: ph.mime, filename: `product-${i + 1}.${ph.mime.split("/")[1] ?? "jpg"}` }))
    }
  }

  const input: DirectorInput = {
    brief: {
      campaignName: campaign.name,
      mode: campaign.mode,
      topic: campaign.brief.topic,
      audience: campaign.brief.audience,
      tone: campaign.brief.tone,
      language: campaign.brief.language,
      targetLengthSec: campaign.brief.targetLengthSec,
      ctaOptions: variation.cta ? [variation.cta] : campaign.brief.cta,
      hashtagSeeds: campaign.brief.hashtagSeeds,
      bannedTopics: campaign.brief.bannedTopics,
      ...(product ? { product: { name: product.name, description: product.description, price: product.price, link: product.link, photoCount: photoRefs.length } } : {}),
    },
    variation,
    model: {
      id: model.id,
      displayName: model.displayName,
      durations: caps.durations.filter((d) => d <= 15),
      promptMaxChars: caps.promptMaxChars,
      supportsNegativePrompt: caps.supportsNegativePrompt,
    },
    history: await campaignHistory(deps.db, campaign.id),
    postDate: new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: schedule.timeZone }).format(run.slotAt),
  }

  let result
  try {
    result = await director.planRun(input)
  } catch (err) {
    if (err instanceof DirectorError) return fail(deps, run, `director_${err.kind}`, err.message)
    throw err
  }

  // One request per scene, built from the model's own schema. Fresh seed every call.
  const inputs = result.plan.scenes.map((s, i) =>
    buildModelInput(model!.inputSchema as ModelInputSchema, {
      prompt: s.prompt,
      negativePrompt: s.negative_prompt || undefined,
      durationSec: s.duration_sec,
      aspectRatio: "9:16",
      resolution: "1080p",
      seed: Math.floor(Math.random() * 1_000_000_000),
      imageUrl: photoRefs.length ? photoRefs[i % photoRefs.length] : undefined,
      nativeAudio: true, // the model's own ambient sound sits under the voiceover
    })
  )
  const estimates = []
  for (const inp of inputs) estimates.push(await provider.estimateCost(model.id, inp))
  const estimate = estimates.reduce((a, e) => ({ credits: a.credits + e.credits, usd: a.usd + e.usd }), { credits: 0, usd: 0 })

  // Budget: caps per run and per month, and the live plan balance when we can read it.
  const spend = await campaignSpend(deps.db, campaign.id, monthStart(schedule.timeZone, now))
  const balance = "balance" in provider && typeof provider.balance === "function" ? await (provider as { balance(): Promise<{ credits: number }> }).balance().catch(() => null) : null
  const decision = checkBudget({
    estimateUsd: estimate.usd,
    perRunCapUsd: campaign.perRunCapUsd,
    monthlyCapUsd: campaign.monthlyCapUsd,
    spentThisMonthUsd: spend.spentUsd,
    heldUsd: spend.heldUsd,
    balanceCredits: balance?.credits ?? (credential.provider === "higgsfield" ? credential.balanceCredits : null),
    estimateCredits: estimate.credits,
    lowBalanceCredits: LOW_BALANCE_CREDITS,
    perRunCapCredits: campaign.perRunCapCredits,
    monthlyCapCredits: campaign.monthlyCapCredits,
    spentThisMonthCredits: spend.spentCredits,
    heldCredits: spend.heldCredits,
  })
  if (!decision.ok) {
    if (decision.reason !== "run_cap") await pauseCampaign(deps.db, campaign.id, decision.reason, decision.message)
    await notify(deps.db, { workspaceId: run.workspaceId, type: "run_skipped_budget", payload: { runId: run.id, campaignId: campaign.id, message: decision.message } })
    return stepRun(deps.db, run, { status: "skipped", finishedAt: now, errorCode: decision.reason, errorMessage: decision.message, nextCheckAt: null }, { name: "skipped_budget" })
  }

  const fresh = await saveFingerprint(deps.db, run, variation, result.hook)
  const warnings = [...result.warnings, ...(fresh ? [] : ["This combination and hook were used before."])]

  for (const [i, inp] of inputs.entries()) {
    await createGenerationJob(deps.db, {
      workspaceId: run.workspaceId,
      runId: run.id,
      campaignId: campaign.id,
      credentialId: credential.id,
      modelId: model.id,
      sceneIndex: i,
      input: inp,
      estimate: estimates[i]!,
      timeoutSec: model.timeoutSec,
    })
  }

  const runPlan: RunPlan = { ...result.plan, modelId: model.id, photoRefs, warnings }
  await upsertVideoForRun(deps.db, run, { status: "generating", title: result.plan.title })
  return stepRun(
    deps.db,
    run,
    { plan: runPlan, variation, estimateCredits: estimate.credits, estimateUsd: estimate.usd, nextCheckAt: new Date(now.getTime() + SCENE_CHECK_MS) },
    { name: "planned", payload: { hook: result.hook, scenes: inputs.length, estimateCredits: estimate.credits, warnings } }
  )
}

// ── generating: wait for scenes, retry failures ───────────────────────────────

async function watchScenes(deps: RunDeps, run: Run) {
  const now = deps.now?.() ?? new Date()
  const plan = run.plan!
  const jobs = await generationJobsForRun(deps.db, run.id)
  const latest = new Map<number, GenerationJob>()
  for (const j of jobs) if (!latest.has(j.sceneIndex) || latest.get(j.sceneIndex)!.attempt < j.attempt) latest.set(j.sceneIndex, j)

  let allStored = latest.size === plan.scenes.length
  for (const [scene, job] of latest) {
    if (job.status === "stored") continue
    allStored = false
    if (!["failed", "nsfw", "timed_out", "canceled"].includes(job.status)) continue
    // Out of credits or a bad key won't fix itself with a retry.
    if (job.errorKind === "no_credits" || job.errorKind === "bad_credentials") {
      await pauseCampaign(deps.db, run.campaignId, job.errorKind === "no_credits" ? "low_balance" : "bad_credentials", job.errorMessage)
      return fail(deps, run, job.errorKind, job.errorMessage ?? "Higgsfield refused the generation.")
    }
    const decision = retryDecision(job.status, job.attempt, job.moderationRetries)
    if (!decision.retry) return fail(deps, run, "scene_failed", `Scene ${scene + 1} couldn't be generated (${job.errorMessage ?? job.status}).`)
    let input = job.input
    if (decision.rewritePrompt) {
      const director = deps.director()
      if (!director) return fail(deps, run, "no_director", "The director agent needs ANTHROPIC_API_KEY to rewrite a rejected prompt.")
      const model = await getModel(deps.db, job.modelId)
      const caps = model ? capabilitiesFromSchema(model.inputSchema as ModelInputSchema) : null
      const s = plan.scenes[scene]!
      try {
        const rewrite = await director.rewriteForModeration(
          { model: { id: job.modelId, displayName: job.modelId, durations: caps?.durations ?? [], promptMaxChars: caps?.promptMaxChars ?? null, supportsNegativePrompt: !!caps?.supportsNegativePrompt } },
          { prompt: String(job.input.prompt ?? s.prompt), negativePrompt: String(job.input.negative_prompt ?? ""), voiceoverLine: s.voiceover_line },
          plan.subject_anchor
        )
        input = { ...job.input, prompt: rewrite.prompt, ...(rewrite.negative_prompt ? { negative_prompt: rewrite.negative_prompt } : {}) }
      } catch (err) {
        return fail(deps, run, "rewrite_failed", `Scene ${scene + 1} was rejected by moderation and couldn't be rewritten (${(err as Error).message}).`)
      }
    }
    if ("seed" in input) input = { ...input, seed: Math.floor(Math.random() * 1_000_000_000) }
    await createGenerationJob(deps.db, {
      workspaceId: run.workspaceId,
      runId: run.id,
      campaignId: run.campaignId,
      credentialId: job.credentialId!,
      modelId: job.modelId,
      sceneIndex: scene,
      input,
      estimate: { credits: job.estimateCredits ?? 0, usd: job.estimateUsd ?? 0 },
      attempt: job.attempt + 1,
      retryOfId: job.id,
      moderationRetries: job.moderationRetries + (decision.rewritePrompt ? 1 : 0),
    })
    log.info("scene retried", { runId: run.id, scene, attempt: job.attempt + 1, rewrite: decision.rewritePrompt })
  }

  if (allStored) return stepRun(deps.db, run, { status: "assembling", nextCheckAt: now, stepAttempts: 0 }, { name: "scenes_ready" })
  return stepRun(deps.db, run, { nextCheckAt: new Date(now.getTime() + SCENE_CHECK_MS) })
}

// ── assembling: voiceover + FFmpeg → Video Library ────────────────────────────

async function assemble(deps: RunDeps, run: Run) {
  const now = deps.now?.() ?? new Date()
  const plan = run.plan!
  const c = await getCampaignWithSchedule(deps.db, run.campaignId)
  if (!c) return fail(deps, run, "no_campaign", "The campaign was deleted.")
  const workDir = path.join(deps.workRoot, run.id)
  mkdirSync(workDir, { recursive: true })
  try {
    const jobs = await generationJobsForRun(deps.db, run.id)
    const scenes = []
    const voiceIssues: string[] = []
    for (const [i, s] of plan.scenes.entries()) {
      const stored = jobs.filter((j) => j.sceneIndex === i && j.status === "stored").sort((a, b) => b.attempt - a.attempt)[0]
      if (!stored?.storageKey) return fail(deps, run, "scene_missing", `Scene ${i + 1}'s clip is missing.`)
      writeFileSync(path.join(workDir, `scene-${i + 1}.mp4`), await deps.storage.getBytes(stored.storageKey))
      let voiceover: string | null = null
      const voice = await deps.speak(s.voiceover_line, run.variation?.voice ?? DEFAULT_VOICES[0]!)
      if (voice.ok) {
        voiceover = `vo-${i + 1}.mp3`
        writeFileSync(path.join(workDir, voiceover), voice.audio)
      } else if (!voiceIssues.includes(voice.error)) voiceIssues.push(voice.error)
      scenes.push({ clip: `scene-${i + 1}.mp4`, durationSec: s.duration_sec, caption: s.caption_words, voiceover })
    }

    const { file, seconds } = await assembleShort(workDir, scenes, { nativeAudio: true })
    const thumbAt = plan.scenes.slice(0, plan.thumbnail_scene_index).reduce((t, s) => t + s.duration_sec, 0) + 1
    const thumb = await grabFrame(workDir, "final.mp4", thumbAt)
    const videoBytes = readFileSync(file)
    const videoKey = `${run.workspaceId}/videos/${run.id}.mp4`
    const thumbKey = `${run.workspaceId}/videos/${run.id}.jpg`
    await deps.storage.put(videoKey, videoBytes, "video/mp4")
    await deps.storage.put(thumbKey, readFileSync(thumb), "image/jpeg")

    const credits = jobs.filter((j) => j.status === "stored").reduce((t, j) => t + (j.estimateCredits ?? 0), 0)
    await upsertVideoForRun(deps.db, run, {
      status: "ready",
      storageKey: videoKey,
      thumbnailKey: thumbKey,
      durationMs: Math.round(seconds * 1000),
      width: 1080,
      height: 1920,
      bytes: videoBytes.byteLength,
      title: plan.title,
      description: buildDescription(plan.description, plan.hashtags),
      tags: normalizeHashtags(plan.hashtags).map((h) => h.slice(1)),
      costUsd: jobs.filter((j) => j.status === "stored").reduce((t, j) => t + (j.estimateUsd ?? 0), 0),
    })
    const toApproval = c.campaign.publishMode === "approval"
    if (toApproval) {
      await notify(deps.db, { workspaceId: run.workspaceId, type: "video_needs_review", payload: { runId: run.id, campaignId: run.campaignId, title: plan.title, url: `/app/approvals/${run.id}` } })
    }
    return stepRun(
      deps.db,
      run,
      { status: toApproval ? "awaiting_approval" : "uploading", nextCheckAt: toApproval ? null : now, stepAttempts: 0 },
      { name: "assembled", payload: { seconds, credits, voice: voiceIssues.length ? voiceIssues : "ok" } }
    )
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

// ── uploading → scheduled → published ─────────────────────────────────────────

async function upload(deps: RunDeps, run: Run) {
  const now = deps.now?.() ?? new Date()
  const c = await getCampaignWithSchedule(deps.db, run.campaignId)
  if (!c) return fail(deps, run, "no_campaign", "The campaign was deleted.")
  const account = await youtubeAccountFor(deps, c.campaign)
  if (!account) return fail(deps, run, "no_channel", "No YouTube channel is connected. The video is in your library; connect a channel to post it.", { keepVideo: true })
  const [video] = await deps.db.select().from(schema.videos).where(eq(schema.videos.runId, run.id))
  if (!video?.storageKey) return fail(deps, run, "no_video", "The finished video is missing.")

  // The time chosen on the review page wins over the slot. YouTube needs it in the future, so a late
  // run posts 15 minutes from now.
  const wanted = video.publishAt ?? run.slotAt
  const publishAt = new Date(Math.max(wanted.getTime(), now.getTime() + 15 * 60_000))
  const outcome = await deps.publish({
    workspaceId: run.workspaceId,
    videoId: video.id,
    account,
    video: await deps.storage.getBytes(video.storageKey),
    cover: video.thumbnailKey ? await deps.storage.getBytes(video.thumbnailKey).catch(() => null) : null,
    title: video.title ?? run.plan?.title ?? "New Short",
    description: video.description ?? "",
    tags: video.tags,
    madeForKids: c.campaign.madeForKids,
    publishAt,
  })
  if (outcome.ok) {
    await setVideoStatus(deps.db, run.id, { status: "scheduled", youtubeAccountId: account.id, youtubeVideoId: outcome.externalPostId, youtubeUrl: outcome.externalUrl, publishAt })
    return stepRun(deps.db, run, { status: "scheduled", nextCheckAt: publishAt }, { name: "uploaded", payload: { youtubeVideoId: outcome.externalPostId, publishAt: publishAt.toISOString() } })
  }
  if (outcome.kind === "auth") {
    await pauseCampaign(deps.db, run.campaignId, "youtube_auth", outcome.error)
    return fail(deps, run, "youtube_auth", `${outcome.error} Reconnect YouTube in Connections.`, { keepVideo: true })
  }
  if (outcome.kind === "retryable" && run.stepAttempts < 5) {
    const delay = Math.min(60_000 * 2 ** run.stepAttempts, 30 * 60_000)
    return stepRun(deps.db, run, { stepAttempts: run.stepAttempts + 1, nextCheckAt: new Date(now.getTime() + delay), errorMessage: outcome.error })
  }
  return fail(deps, run, "youtube_upload", outcome.error, { keepVideo: true })
}

async function markPublished(deps: RunDeps, run: Run) {
  const now = deps.now?.() ?? new Date()
  if (now < run.slotAt) return stepRun(deps.db, run, { nextCheckAt: run.slotAt })
  await setVideoStatus(deps.db, run.id, { status: "published", publishedAt: run.slotAt })
  await recordRunSuccess(deps.db, run.campaignId)
  return stepRun(deps.db, run, { status: "published", finishedAt: now, nextCheckAt: null }, { name: "published" })
}

async function youtubeAccountFor(deps: RunDeps, campaign: Campaign) {
  if (campaign.youtubeAccountId) {
    const [a] = await deps.db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.id, campaign.youtubeAccountId))
    if (a?.status === "active") return a
  }
  return getActiveAccount(deps.db, campaign.workspaceId, "youtube")
}

// ── failure ───────────────────────────────────────────────────────────────────

async function fail(deps: RunDeps, run: Run, code: string, message: string, opts: { keepVideo?: boolean } = {}) {
  const now = deps.now?.() ?? new Date()
  log.warn("run failed", { runId: run.id, code, message })
  const row = await stepRun(deps.db, run, { status: "failed", finishedAt: now, errorCode: code, errorMessage: message, nextCheckAt: null }, { name: "failed", payload: { code, message } })
  if (row) {
    // A finished video that just couldn't be posted stays "ready" in the library.
    if (!opts.keepVideo) await setVideoStatus(deps.db, run.id, { status: "failed" })
    const paused = await recordRunFailure(deps.db, run.campaignId)
    await notify(deps.db, { workspaceId: run.workspaceId, type: "run_failed", payload: { runId: run.id, campaignId: run.campaignId, code, message, campaignPaused: paused } })
  }
  return row
}
