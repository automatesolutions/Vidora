import { describe, expect, it } from "vitest"
import {
  ScheduleSchema,
  buildDescription,
  buildModelInput,
  capabilitiesFromSchema,
  checkBudget,
  classifyProviderHttp,
  decryptToken,
  encryptToken,
  formatPostTime,
  monthStart,
  newId,
  nextPollDelayMs,
  normalizeHashtags,
  pickDuration,
  retryDecision,
  seal,
  statusFromProvider,
  suggestPostTime,
  tokenKeysFromEnv,
  unseal,
  youtubeUploadStatus,
  type ModelInputSchema,
} from "./index"

describe("ids", () => {
  it("is prefixed, 26 chars after the prefix, and sorts by time", () => {
    const a = newId("generation", 1_700_000_000_000)
    const b = newId("generation", 1_700_000_000_001)
    expect(a).toMatch(/^gen_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(a < b).toBe(true)
  })
})

describe("generation rules", () => {
  it("maps provider statuses onto ours", () => {
    expect(statusFromProvider("pending", "queued")).toBe("submitted")
    expect(statusFromProvider("submitted", "queued")).toBe("submitted")
    expect(statusFromProvider("submitted", "in_progress")).toBe("in_progress")
    expect(statusFromProvider("in_progress", "completed")).toBe("completed")
    expect(statusFromProvider("in_progress", "nsfw")).toBe("nsfw")
    expect(statusFromProvider("in_progress", "something_new")).toBe("in_progress")
  })

  it("backs off polling from about 5 s to a 30 s cap", () => {
    const none = () => 0
    expect(nextPollDelayMs(0, none)).toBe(5_000)
    expect(nextPollDelayMs(1, none)).toBe(7_500)
    expect(nextPollDelayMs(20, none)).toBe(30_000)
    expect(nextPollDelayMs(0, () => 0.999)).toBeLessThan(6_000)
  })

  it("classifies Higgsfield's documented errors", () => {
    expect(classifyProviderHttp(401, "Invalid credentials")).toBe("bad_credentials")
    expect(classifyProviderHttp(403, "")).toBe("no_credits")
    expect(classifyProviderHttp(400, "Maximum number of concurrent requests (4) has been reached")).toBe("wait")
    expect(classifyProviderHttp(400, "bad prompt")).toBe("invalid")
    expect(classifyProviderHttp(423, "")).toBe("wait")
    expect(classifyProviderHttp(502, "")).toBe("retry_same")
  })

  it("retries failures twice, and moderation once with a rewritten prompt", () => {
    expect(retryDecision("failed", 1, 0)).toEqual({ retry: true, rewritePrompt: false })
    expect(retryDecision("failed", 2, 0)).toEqual({ retry: true, rewritePrompt: false })
    expect(retryDecision("failed", 3, 0)).toEqual({ retry: false })
    expect(retryDecision("timed_out", 1, 0)).toEqual({ retry: true, rewritePrompt: false })
    expect(retryDecision("nsfw", 1, 0)).toEqual({ retry: true, rewritePrompt: true })
    expect(retryDecision("nsfw", 2, 1)).toEqual({ retry: false })
    expect(retryDecision("canceled", 1, 0)).toEqual({ retry: false })
  })
})

describe("model input", () => {
  const kling: ModelInputSchema = {
    properties: {
      sound: { type: "string", enum: ["on", "off"], default: "on" },
      prompt: { type: "string" },
      duration: { type: "integer", default: 5, minimum: 3, maximum: 15 },
      aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], default: "16:9" },
    },
  }
  const wanI2v: ModelInputSchema = {
    required: ["prompt", "image_url"],
    properties: {
      seed: { type: "integer", minimum: -1, maximum: 10_000_000 },
      prompt: { type: "string" },
      duration: { type: "integer", enum: [5, 10, 15], default: 5 },
      image_url: { type: "string", format: "uri" },
      resolution: { type: "string", enum: ["480p", "720p", "1080p"], default: "720p" },
      negative_prompt: { type: "string" },
    },
  }

  it("builds a vertical Kling request with native sound off", () => {
    expect(buildModelInput(kling, { prompt: "sunrise over Manila Bay", durationSec: 6, aspectRatio: "9:16", seed: 42 })).toEqual({
      prompt: "sunrise over Manila Bay",
      duration: 6,
      aspect_ratio: "9:16",
      sound: "off",
    })
  })

  it("never asks for more resolution than wanted when the exact one isn't offered", () => {
    const seedance = { type: "object" as const, properties: { prompt: { type: "string" }, resolution: { type: "string", enum: ["480p", "720p", "1080p"] }, aspect_ratio: { type: "string", enum: ["9:16"] } } }
    const odd = { type: "object" as const, properties: { prompt: { type: "string" }, resolution: { type: "string", enum: ["540p", "768p", "1080p"] }, aspect_ratio: { type: "string", enum: ["9:16"] } } }
    expect(buildModelInput(seedance, { prompt: "p", durationSec: 5, aspectRatio: "9:16", resolution: "720p" }).resolution).toBe("720p")
    expect(buildModelInput(odd, { prompt: "p", durationSec: 5, aspectRatio: "9:16", resolution: "720p" }).resolution).toBe("540p")
  })

  it("only sends fields the model documents, and rounds duration up to an allowed value", () => {
    const body = buildModelInput(wanI2v, {
      prompt: "slow push in",
      negativePrompt: "blurry",
      durationSec: 7,
      aspectRatio: "9:16",
      seed: 123_456_789,
      imageUrl: "https://cdn.example.com/p.jpg",
      resolution: "1080p",
    })
    expect(body).toEqual({
      prompt: "slow push in",
      negative_prompt: "blurry",
      duration: 10,
      resolution: "1080p",
      seed: expect.any(Number),
      image_url: "https://cdn.example.com/p.jpg",
    })
    expect(body.seed as number).toBeLessThanOrEqual(10_000_000)
    expect(body.seed as number).toBeGreaterThanOrEqual(-1)
  })

  it("refuses models that can't do what the run needs", () => {
    expect(() => buildModelInput({ properties: { prompt: {}, aspect_ratio: { enum: ["16:9"] } } }, { prompt: "x", durationSec: 5, aspectRatio: "9:16" })).toThrow(/9:16/)
    expect(() => buildModelInput({ properties: { prompt: {}, duration: { enum: [5, 10] } } }, { prompt: "x", durationSec: 5, aspectRatio: "9:16" })).toThrow(/input image/)
    expect(() => buildModelInput(wanI2v, { prompt: "x", durationSec: 5, aspectRatio: "9:16" })).toThrow(/image_url/)
    expect(() => buildModelInput(kling, { prompt: "x", durationSec: 5, aspectRatio: "9:16", imageUrl: "https://x/y.jpg" })).toThrow(/input image/)
  })

  it("handles string duration enums and the longest-available fallback", () => {
    expect(pickDuration({ type: "string", enum: ["5", "10"] }, 6)).toBe("10")
    expect(pickDuration({ enum: [5, 10] }, 30)).toBe(10)
    expect(pickDuration(undefined, 5)).toBeUndefined()
  })

  it("reads capabilities from a schema", () => {
    expect(capabilitiesFromSchema(kling)).toMatchObject({ durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], verticalFromText: true, needsImage: false })
    expect(capabilitiesFromSchema(wanI2v)).toMatchObject({ durations: [5, 10, 15], verticalFromText: false, needsImage: true, supportsSeed: true })
  })
})

describe("budget", () => {
  const base = {
    estimateUsd: 1.2,
    perRunCapUsd: 2,
    monthlyCapUsd: 30,
    spentThisMonthUsd: 10,
    heldUsd: 1,
    balanceCredits: null,
    estimateCredits: 20,
    lowBalanceCredits: 50,
  }
  it("allows a run inside every cap", () => expect(checkBudget(base)).toEqual({ ok: true }))
  it("stops a run over the per-run cap", () => expect(checkBudget({ ...base, estimateUsd: 2.5 })).toMatchObject({ ok: false, reason: "run_cap" }))
  it("counts held spend toward the monthly cap", () =>
    expect(checkBudget({ ...base, spentThisMonthUsd: 28, heldUsd: 1 })).toMatchObject({ ok: false, reason: "monthly_cap" }))
  it("stops before the balance runs low", () => expect(checkBudget({ ...base, balanceCredits: 60 })).toMatchObject({ ok: false, reason: "low_balance" }))
  it("enforces credit caps for plan credits", () => {
    expect(checkBudget({ ...base, perRunCapUsd: null, monthlyCapUsd: null, estimateUsd: 0, estimateCredits: 40, perRunCapCredits: 30 })).toMatchObject({ ok: false, reason: "run_cap" })
    expect(checkBudget({ ...base, perRunCapUsd: null, monthlyCapUsd: null, estimateUsd: 0, estimateCredits: 30, monthlyCapCredits: 300, spentThisMonthCredits: 250, heldCredits: 30 })).toMatchObject({ ok: false, reason: "monthly_cap" })
    expect(checkBudget({ ...base, perRunCapUsd: null, monthlyCapUsd: null, estimateUsd: 0, estimateCredits: 30, monthlyCapCredits: 300, spentThisMonthCredits: 200 })).toEqual({ ok: true })
  })
  it("treats null caps as no limit", () =>
    expect(checkBudget({ ...base, perRunCapUsd: null, monthlyCapUsd: null, estimateUsd: 500 })).toEqual({ ok: true }))
  it("starts the month in the workspace's time zone", () => {
    // 2026-10-31 20:00 UTC is already Nov 1 04:00 in Manila (UTC+8)
    expect(monthStart("Asia/Manila", new Date("2026-10-31T20:00:00Z")).toISOString()).toBe("2026-10-31T16:00:00.000Z")
    expect(monthStart("UTC", new Date("2026-10-31T20:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z")
  })
})

describe("schedule", () => {
  it("defaults to Manila and 24 hours ahead", () => {
    expect(ScheduleSchema.parse({ frequency: "daily", times: ["18:00"] })).toMatchObject({ timeZone: "Asia/Manila", generateAheadHours: 24, days: [] })
  })
  it("needs three days for 3x per week and one for weekly", () => {
    expect(ScheduleSchema.safeParse({ frequency: "three_per_week", days: [1, 3], times: ["18:00"] }).success).toBe(false)
    expect(ScheduleSchema.safeParse({ frequency: "three_per_week", days: [1, 3, 5], times: ["18:00"] }).success).toBe(true)
    expect(ScheduleSchema.safeParse({ frequency: "weekly", days: [1, 2], times: ["18:00"] }).success).toBe(false)
    expect(ScheduleSchema.safeParse({ frequency: "custom", days: [], times: ["18:00"] }).success).toBe(false)
  })
  it("rejects bad times and zones", () => {
    expect(ScheduleSchema.safeParse({ frequency: "daily", times: ["25:00"] }).success).toBe(false)
    expect(ScheduleSchema.safeParse({ frequency: "daily", times: ["18:00"], timeZone: "Mars/Base" }).success).toBe(false)
  })
})

describe("youtube", () => {
  it("adds #Shorts once, cleans tags, and caps at 15", () => {
    expect(normalizeHashtags(["money", "#Money", "##saving tips", "#shorts", "  "])).toEqual(["#Shorts", "#money", "#savingtips"])
    expect(normalizeHashtags(Array.from({ length: 40 }, (_, i) => `t${i}`))).toHaveLength(15)
  })

  it("puts hashtags after the description and stays under 5000 characters", () => {
    expect(buildDescription("Three habits.", ["money"])).toBe("Three habits.\n\n#Shorts #money")
    expect(buildDescription("x".repeat(6000), ["money"]).length).toBeLessThanOrEqual(5000)
  })

  it("uploads private until the audit passes, and always labels synthetic media", () => {
    expect(youtubeUploadStatus({ visibility: "public", audited: false, madeForKids: false })).toEqual({
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    })
  })

  it("handles time zones across DST", () => {
    expect(suggestPostTime("Asia/Manila", new Date("2026-10-11T01:00:00Z")).toISOString()).toBe("2026-10-11T10:00:00.000Z")
    expect(suggestPostTime("America/New_York", new Date("2026-11-01T12:00:00Z")).toISOString()).toBe("2026-11-01T23:00:00.000Z")
    expect(formatPostTime(new Date("2026-10-13T22:00:00Z"), "America/New_York")).toBe("Tue 6:00 PM")
  })
})

describe("token encryption", () => {
  const k1 = "1:" + "a".repeat(64)
  const k2 = "2:" + "b".repeat(64)

  it("round-trips, rotates, and fails on tampering", () => {
    const keys = tokenKeysFromEnv(k1)
    const { ciphertext } = encryptToken("kid:secret", keys)
    expect(ciphertext).not.toContain("secret")
    expect(decryptToken(ciphertext, keys)).toBe("kid:secret")
    const rotated = tokenKeysFromEnv(`${k2},${k1}`)
    expect(decryptToken(ciphertext, rotated)).toBe("kid:secret")
    expect(encryptToken("x", rotated).keyVersion).toBe(2)
    const parts = ciphertext.split(".")
    expect(() => decryptToken([parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join("."), keys)).toThrow()
    expect(() => decryptToken(ciphertext, tokenKeysFromEnv(k2))).toThrow(/unknown key/)
  })

  it("opens a fresh seal and refuses tampered or expired ones", () => {
    const now = 1_760_000_000_000
    const s = seal({ generationId: "gen_1" }, "secret", 600, now)
    expect(unseal(s, "secret", now)).toMatchObject({ generationId: "gen_1" })
    expect(unseal(s, "other", now)).toBeNull()
    expect(unseal(s, "secret", now + 601_000)).toBeNull()
  })
})
