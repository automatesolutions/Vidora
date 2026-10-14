import { describe, expect, it } from "vitest"
import {
  GenerateRequestSchema,
  SHORT_LENGTHS,
  VideoBriefSchema,
  buildDescription,
  changeRequestCost,
  creditsForNewVideo,
  decryptToken,
  encryptToken,
  formatPostTime,
  normalizeHashtags,
  seal,
  shortCreditCost,
  shortMaxCostUsd,
  suggestPostTime,
  tokenKeysFromEnv,
  unseal,
  youtubeUploadStatus,
  type VideoBrief,
} from "./index"

describe("short pricing", () => {
  it("charges 6 credits for 8 s and 10 for 15 s", () => {
    expect(shortCreditCost(8)).toBe(6)
    expect(shortCreditCost(15)).toBe(10)
    expect(() => shortCreditCost(30)).toThrow(/8 or 15/)
  })

  it("keeps the spend cap under the provider budget ($0.08 per credit)", () => {
    for (const len of SHORT_LENGTHS) expect(shortMaxCostUsd(len)).toBeLessThan(shortCreditCost(len) * 0.08)
  })

  it("makes the first video free but keeps its list price for change requests", () => {
    expect(creditsForNewVideo({ lengthSec: 15, freeVideoAvailable: true })).toEqual({ creditsBase: 10, credits: 0, isFree: true })
    expect(creditsForNewVideo({ lengthSec: 8, freeVideoAvailable: false })).toEqual({ creditsBase: 6, credits: 6, isFree: false })
  })

  it("prices change requests from the video's own cost", () => {
    expect(changeRequestCost(10, "script", 1)).toBe(0)
    expect(changeRequestCost(10, "script", 2)).toBe(10)
    expect(changeRequestCost(6, "thumbnail", 2)).toBe(1) // 12% of 6, rounded up
    expect(changeRequestCost(6, "render", 5)).toBe(1) // never zero once paid
  })
})

const brief = (over: Partial<VideoBrief> = {}): VideoBrief => ({
  creator_kind: "creator",
  video_type: "fact_tip",
  topic: "Why octopuses have three hearts",
  source_url: null,
  photo_upload_id: null,
  no_people_confirmed: false,
  look: "cinematic",
  voice: "calm",
  language: "en",
  captions_style: "bold_words",
  length_sec: 15,
  use_brand_kit: false,
  ...over,
})

describe("video brief", () => {
  it("accepts a fact video with a topic", () => {
    expect(VideoBriefSchema.safeParse(brief()).success).toBe(true)
  })

  it("needs a topic for facts and quotes", () => {
    const r = VideoBriefSchema.safeParse(brief({ video_type: "quote", topic: " " }))
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(["topic"])
  })

  it("needs a link or a photo for a product showcase", () => {
    expect(VideoBriefSchema.safeParse(brief({ video_type: "product_showcase", topic: null })).success).toBe(false)
    expect(VideoBriefSchema.safeParse(brief({ video_type: "product_showcase", source_url: "https://example.com/serum" })).success).toBe(true)
    expect(VideoBriefSchema.safeParse(brief({ video_type: "product_showcase", photo_upload_id: "upl_01" })).success).toBe(true)
  })

  it("refuses private and non-http links", () => {
    for (const url of ["http://localhost:3010", "http://192.168.1.1/x", "ftp://example.com/a", "javascript:alert(1)"]) {
      expect(VideoBriefSchema.safeParse(brief({ video_type: "product_showcase", source_url: url })).success, url).toBe(false)
    }
  })

  it("needs a photo and the no-people check to bring a photo to life", () => {
    const base = { video_type: "photo_to_life" as const, topic: null }
    expect(VideoBriefSchema.safeParse(brief({ ...base, photo_upload_id: "upl_01" })).success).toBe(false)
    expect(VideoBriefSchema.safeParse(brief({ ...base, photo_upload_id: "upl_01", no_people_confirmed: true })).success).toBe(true)
  })

  it("only offers 8 and 15 second lengths", () => {
    expect(VideoBriefSchema.safeParse({ ...brief(), length_sec: 30 }).success).toBe(false)
  })
})

describe("generate request", () => {
  const legacy = {
    job_id: "job_01",
    revision: 1,
    workspace_id: "ws_01",
    rerun_from_stage: null,
    feedback: null,
    strategy: { niche: "general", audience: "general audience", tone: "friendly", language: "en", format: "short", target_length_sec: 45, visual_style: "hybrid" },
    topic: "3 money habits",
    providers: { llm: "x", tts: "x", video: "x", image: "x", tier: "short_standard" },
    limits: { max_cost_usd: 3, max_clip_seconds: 40 },
    reuse_assets: {},
    callback_url: "http://localhost:3010/api/webhooks/n8n",
  }

  it("still accepts the Phase 0 payload (smoke test)", () => {
    expect(GenerateRequestSchema.safeParse(legacy).success).toBe(true)
  })

  it("accepts the wizard fields", () => {
    const r = GenerateRequestSchema.safeParse({
      ...legacy,
      video_type: "photo_to_life",
      look: "anime",
      voice: "music_only",
      captions_style: "none",
      length_sec: 8,
      source_url: null,
      brand_kit: { logo_key: "ws_01/uploads/upl_1.png", colors: ["#FF4F00"], end_card_text: "Follow for more" },
      input_assets: [{ kind: "photo", storage_key: "ws_01/uploads/upl_2.jpg", mime: "image/jpeg" }],
    })
    expect(r.success).toBe(true)
  })

  it("rejects a wizard length the pricing doesn't cover", () => {
    expect(GenerateRequestSchema.safeParse({ ...legacy, length_sec: 20 }).success).toBe(false)
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
    expect(buildDescription("", [])).toBe("#Shorts")
  })

  it("uploads private until the audit passes, and always labels synthetic media", () => {
    expect(youtubeUploadStatus({ visibility: "public", audited: false, madeForKids: false })).toEqual({
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    })
    expect(youtubeUploadStatus({ visibility: "unlisted", audited: true, madeForKids: true }).privacyStatus).toBe("unlisted")
  })

  it("suggests the next 6 PM local time at least an hour away", () => {
    // 2026-10-11 15:00 UTC = 11:00 in New York (EDT, UTC-4) → 18:00 EDT the same day = 22:00 UTC
    expect(suggestPostTime("America/New_York", new Date("2026-10-11T15:00:00Z")).toISOString()).toBe("2026-10-11T22:00:00.000Z")
    // 17:30 in New York is under an hour before 6 PM → next day
    expect(suggestPostTime("America/New_York", new Date("2026-10-11T21:30:00Z")).toISOString()).toBe("2026-10-12T22:00:00.000Z")
    // Manila has no DST: 18:00 PHT = 10:00 UTC
    expect(suggestPostTime("Asia/Manila", new Date("2026-10-11T01:00:00Z")).toISOString()).toBe("2026-10-11T10:00:00.000Z")
    // Across the US DST change (Nov 1, 2026): 6 PM EST = 23:00 UTC
    expect(suggestPostTime("America/New_York", new Date("2026-11-01T12:00:00Z")).toISOString()).toBe("2026-11-01T23:00:00.000Z")
  })

  it("formats the approve label time", () => {
    expect(formatPostTime(new Date("2026-10-13T22:00:00Z"), "America/New_York")).toBe("Tue 6:00 PM")
  })
})

describe("token encryption", () => {
  const k1 = "1:" + "a".repeat(64)
  const k2 = "2:" + "b".repeat(64)

  it("round-trips and records the key version", () => {
    const keys = tokenKeysFromEnv(k1)
    const { ciphertext, keyVersion } = encryptToken("ya29.secret", keys)
    expect(keyVersion).toBe(1)
    expect(ciphertext).not.toContain("ya29")
    expect(decryptToken(ciphertext, keys)).toBe("ya29.secret")
  })

  it("decrypts old rows after a rotation and encrypts with the newest key", () => {
    const old = encryptToken("refresh-1", tokenKeysFromEnv(k1)).ciphertext
    const rotated = tokenKeysFromEnv(`${k2},${k1}`)
    expect(decryptToken(old, rotated)).toBe("refresh-1")
    expect(encryptToken("x", rotated).keyVersion).toBe(2)
  })

  it("fails on tampering and on unknown keys", () => {
    const keys = tokenKeysFromEnv(k1)
    const c = encryptToken("refresh-1", keys).ciphertext
    const parts = c.split(".")
    const flipped = [parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join(".")
    expect(() => decryptToken(flipped, keys)).toThrow()
    expect(() => decryptToken(c, tokenKeysFromEnv(k2))).toThrow(/unknown key/)
    expect(() => tokenKeysFromEnv("1:short")).toThrow()
    expect(() => tokenKeysFromEnv("")).toThrow()
  })
})

describe("sealed state", () => {
  const now = 1_760_000_000_000
  it("opens a fresh seal and refuses tampered or expired ones", () => {
    const s = seal({ jobId: "job_1" }, "secret", 600, now)
    expect(unseal(s, "secret", now)).toMatchObject({ jobId: "job_1" })
    expect(unseal(s, "other", now)).toBeNull()
    expect(unseal(s.replace(/^./, "x"), "secret", now)).toBeNull()
    expect(unseal(s, "secret", now + 601_000)).toBeNull()
  })
})
