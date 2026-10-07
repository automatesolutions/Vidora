import { describe, expect, it } from "vitest"
import {
  CallbackEventSchema,
  JOB_EVENTS,
  JOB_STATUSES,
  TransitionError,
  applyLedger,
  availableJobEvents,
  changeRequestCost,
  newId,
  nextPublishRetryDelay,
  rerunFromStage,
  rollUpPublish,
  signHeaders,
  transitionJob,
  transitionPost,
  verifySignature,
  InsufficientCreditsError,
} from "./index"

describe("ids", () => {
  it("is prefixed, 26 chars after the prefix, and sorts by time", () => {
    const a = newId("job", 1_700_000_000_000)
    const b = newId("job", 1_700_000_000_001)
    expect(a).toMatch(/^job_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(a < b).toBe(true)
  })
})

describe("job state machine", () => {
  it("follows the happy path from queued to published", () => {
    const path: [string, string][] = [
      ["claim", "generating"],
      ["complete", "pending_approval"],
      ["approve", "approved"],
      ["schedule", "scheduled"],
      ["start_publish", "publishing"],
      ["publish_done", "published"],
    ]
    let s = "queued" as Parameters<typeof transitionJob>[0]
    for (const [event, to] of path) {
      s = transitionJob(s, event as Parameters<typeof transitionJob>[1]).to
      expect(s).toBe(to)
    }
  })

  it("charges credits when a video is ready and releases them on failure", () => {
    expect(transitionJob("generating", "complete").effects).toContain("charge_credits")
    expect(transitionJob("generating", "fail").effects).toContain("release_credits")
  })

  it("requeues changes with a new revision and a dispatch", () => {
    expect(transitionJob("pending_approval", "request_changes").to).toBe("changes_requested")
    const r = transitionJob("changes_requested", "requeue")
    expect(r.to).toBe("queued")
    expect(r.effects).toEqual(expect.arrayContaining(["bump_revision", "dispatch_generation"]))
  })

  it("only releases credits on cancel while they are still reserved", () => {
    expect(transitionJob("queued", "cancel").effects).toContain("release_credits")
    expect(transitionJob("pending_approval", "cancel").effects).not.toContain("release_credits")
  })

  it("rejects transitions that are not allowed", () => {
    expect(() => transitionJob("queued", "approve")).toThrow(TransitionError)
    expect(() => transitionJob("published", "cancel")).toThrow(TransitionError)
    expect(() => transitionJob("rejected", "approve")).toThrow(TransitionError)
  })

  it("keeps published and canceled terminal", () => {
    expect(availableJobEvents("published")).toEqual([])
    expect(availableJobEvents("canceled")).toEqual([])
  })

  it("leaves no status unreachable", () => {
    const reachable = new Set<string>(["queued"])
    for (const s of JOB_STATUSES) for (const e of JOB_EVENTS) {
      try {
        reachable.add(transitionJob(s, e).to)
      } catch {}
    }
    expect([...JOB_STATUSES].filter((s) => !reachable.has(s))).toEqual([])
  })
})

describe("posts", () => {
  it("moves through publish states and retries", () => {
    expect(transitionPost("scheduled", "start")).toBe("publishing")
    expect(transitionPost("publishing", "fail")).toBe("failed")
    expect(transitionPost("failed", "retry")).toBe("scheduled")
    expect(transitionPost("publishing", "auth_failed")).toBe("needs_reauth")
  })

  it("backs off 1m, 5m, 30m, 2h, then stops", () => {
    expect([1, 2, 3, 4, 5].map(nextPublishRetryDelay)).toEqual([60_000, 300_000, 1_800_000, 7_200_000, null])
  })

  it("rolls post results up into one job event", () => {
    expect(rollUpPublish(["published", "published"])).toBe("publish_done")
    expect(rollUpPublish(["published", "failed"])).toBe("publish_partial")
    expect(rollUpPublish(["failed", "needs_reauth"])).toBe("publish_fail")
    expect(rollUpPublish(["published", "publishing"])).toBeNull()
    expect(rollUpPublish(["published", "canceled"])).toBe("publish_done")
  })
})

describe("credits", () => {
  it("reserves, charges, and releases", () => {
    let b = applyLedger({ available: 0, reserved: 0 }, "grant", 160)
    b = applyLedger(b, "reserve", 20)
    expect(b).toEqual({ available: 140, reserved: 20 })
    b = applyLedger(b, "charge", 20)
    expect(b).toEqual({ available: 140, reserved: 0 })
    b = applyLedger(b, "reserve", 20)
    b = applyLedger(b, "release", 20)
    expect(b).toEqual({ available: 140, reserved: 0 })
  })

  it("refuses to reserve more than is available", () => {
    expect(() => applyLedger({ available: 10, reserved: 0 }, "reserve", 20)).toThrow(InsufficientCreditsError)
  })

  it("starts reruns at the earliest picked part", () => {
    expect(rerunFromStage(["thumbnail", "voice"])).toBe("voiceover")
    expect(rerunFromStage(["captions"])).toBe("captions")
    expect(() => rerunFromStage([])).toThrow()
  })

  it("makes the first two change requests free and prices the rest by stage", () => {
    expect(changeRequestCost("short_standard", "script", 0)).toBe(0)
    expect(changeRequestCost("short_standard", "script", 1)).toBe(0)
    expect(changeRequestCost("short_standard", "script", 2)).toBe(20) // reruns ~98% of the pipeline
    expect(changeRequestCost("short_standard", "thumbnail", 2)).toBe(3) // thumbnail + render = 12%
  })
})

describe("signing", () => {
  const body = JSON.stringify({ hello: "world" })
  const now = 1_759_850_000_000

  it("verifies a fresh signature", () => {
    const h = signHeaders(["secret-a"], body, now)
    expect(
      verifySignature({ secrets: ["secret-a"], rawBody: body, signatureHeader: h["x-vidora-signature"], timestampHeader: h["x-vidora-timestamp"], now })
    ).toEqual({ ok: true })
  })

  it("accepts either key during rotation", () => {
    const h = signHeaders(["new", "old"], body, now)
    expect(verifySignature({ secrets: ["old"], rawBody: body, signatureHeader: h["x-vidora-signature"], timestampHeader: h["x-vidora-timestamp"], now }).ok).toBe(true)
  })

  it("rejects a changed body, a wrong key, and an old timestamp", () => {
    const h = signHeaders(["secret-a"], body, now)
    const base = { signatureHeader: h["x-vidora-signature"], timestampHeader: h["x-vidora-timestamp"] }
    expect(verifySignature({ ...base, secrets: ["secret-a"], rawBody: body + " ", now })).toEqual({ ok: false, reason: "mismatch" })
    expect(verifySignature({ ...base, secrets: ["secret-b"], rawBody: body, now })).toEqual({ ok: false, reason: "mismatch" })
    expect(verifySignature({ ...base, secrets: ["secret-a"], rawBody: body, now: now + 301_000 })).toEqual({ ok: false, reason: "stale" })
    expect(verifySignature({ secrets: ["secret-a"], rawBody: body, signatureHeader: null, timestampHeader: null, now })).toEqual({ ok: false, reason: "missing" })
  })
})

describe("contracts", () => {
  it("requires an error on job.failed", () => {
    const base = { event_id: "evt_12345678", job_id: "job_X", revision: 1, execution_id: "1" }
    expect(CallbackEventSchema.safeParse({ ...base, type: "job.failed" }).success).toBe(false)
    expect(
      CallbackEventSchema.safeParse({ ...base, type: "job.failed", error: { code: "provider_timeout", message: "x", retryable: true } }).success
    ).toBe(true)
  })

  it("fills defaults for optional callback fields", () => {
    const e = CallbackEventSchema.parse({ event_id: "evt_12345678", type: "job.stage_started", job_id: "job_X", revision: 1, execution_id: "1", stage: "script" })
    expect(e.assets).toEqual([])
    expect(e.cost).toEqual([])
    expect(e.error).toBeNull()
  })
})
