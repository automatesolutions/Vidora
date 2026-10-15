import { ProviderError } from "@vidora/core"
import { describe, expect, it } from "vitest"
import { extractSchema, familyLinks, parseWorkflowPage, workflowLinks } from "./higgsfield/catalog"
import { HiggsfieldProvider, parseStatus } from "./higgsfield/provider"

// A fake Higgsfield: records every call and answers from a handler.
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }
function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const f = (async (input: URL | string, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const c = { url: String(input), method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(c)
    return handler(c)
  }) as typeof fetch
  return { f, calls }
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

const RID = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff"
const accepted = {
  status: "queued",
  request_id: RID,
  status_url: `https://api.higgsfield.ai/requests/${RID}/status`,
  cancel_url: `https://api.higgsfield.ai/requests/${RID}/cancel`,
}
const make = (f: typeof fetch) => new HiggsfieldProvider({ credentials: "kid:secret", fetch: f })

describe("HiggsfieldProvider", () => {
  it("submits with the Key header, idempotency key and webhook, and returns the request handle", async () => {
    const { f, calls } = fakeFetch(() => json(200, accepted, { "x-correlation-id": "corr-1" }))
    const sub = await make(f).submitGeneration({
      modelId: "kling-video/v3.0/std/text-to-video",
      input: { prompt: "a beach", aspect_ratio: "9:16" },
      idempotencyKey: "idem-1",
      webhookUrl: "https://app.example.com/api/webhooks/higgsfield/gen_1?t=abc",
    })
    expect(sub).toEqual({ requestId: RID, status: "queued", statusUrl: accepted.status_url, cancelUrl: accepted.cancel_url, correlationId: "corr-1" })
    const c = calls[0]!
    expect(c.method).toBe("POST")
    expect(c.headers.authorization).toBe("Key kid:secret")
    expect(c.headers["idempotency-key"]).toBe("idem-1")
    const url = new URL(c.url)
    expect(url.pathname).toBe("/kling-video/v3.0/std/text-to-video")
    expect(url.searchParams.get("hf_webhook")).toBe("https://app.example.com/api/webhooks/higgsfield/gen_1?t=abc")
    expect(c.body).toEqual({ prompt: "a beach", aspect_ratio: "9:16" })
  })

  it("never follows a status URL to another host with the key", async () => {
    const { f, calls } = fakeFetch(() => json(200, { ...accepted, status_url: "https://evil.example/steal", cancel_url: null }))
    const sub = await make(f).submitGeneration({ modelId: "wan/v2.6/text-to-video", input: {}, idempotencyKey: "k" })
    expect(sub.statusUrl).toBe(`https://api.higgsfield.ai/requests/${RID}/status`)
    await make(f).pollStatus({ requestId: RID, statusUrl: "https://evil.example/steal" })
    expect(calls.every((c) => new URL(c.url).origin === "https://api.higgsfield.ai")).toBe(true)
  })

  it("rejects endpoint IDs that could escape the API path", async () => {
    const { f } = fakeFetch(() => json(200, accepted))
    await expect(make(f).submitGeneration({ modelId: "../requests/x", input: {}, idempotencyKey: "k" })).rejects.toThrow(/endpoint/)
    await expect(make(f).submitGeneration({ modelId: "https://evil.example/x", input: {}, idempotencyKey: "k" })).rejects.toThrow(/endpoint/)
  })

  it("maps documented errors to retry decisions", async () => {
    const cases: [number, unknown, string][] = [
      [401, { detail: "Invalid credentials" }, "bad_credentials"],
      [403, { detail: "Not enough credits" }, "no_credits"],
      [400, { detail: "Maximum number of concurrent requests (4) has been reached" }, "wait"],
      [400, { detail: "prompt is required" }, "invalid"],
      [422, { detail: [{ loc: ["body", "duration"], msg: "must be <= 15" }] }, "invalid"],
      [423, { detail: "blocked" }, "wait"],
      [503, { detail: "not ready" }, "wait"],
      [500, { detail: "boom" }, "retry_same"],
    ]
    for (const [status, body, kind] of cases) {
      const { f } = fakeFetch(() => json(status, body, { "x-correlation-id": "c" }))
      const err = await make(f).submitGeneration({ modelId: "wan/v2.6/text-to-video", input: {}, idempotencyKey: "k" }).catch((e) => e)
      expect(err).toBeInstanceOf(ProviderError)
      expect([status, err.kind]).toEqual([status, kind])
      expect(err.correlationId).toBe("c")
    }
    const { f } = fakeFetch(() => json(422, { detail: [{ loc: ["body", "duration"], msg: "must be <= 15" }] }))
    const err = await make(f).submitGeneration({ modelId: "wan/v2.6/text-to-video", input: {}, idempotencyKey: "k" }).catch((e) => e)
    expect(err.message).toBe("duration: must be <= 15")
  })

  it("treats a network failure as ambiguous (retry with the same key)", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch
    const err = await make(f).submitGeneration({ modelId: "wan/v2.6/text-to-video", input: {}, idempotencyKey: "k" }).catch((e) => e)
    expect(err.kind).toBe("retry_same")
  })

  it("reads completed video, image and audio outputs, and terminal failures", async () => {
    expect(parseStatus({ status: "completed", request_id: RID, video: { url: "https://cdn/x.mp4" } }, RID).output).toEqual({
      url: "https://cdn/x.mp4",
      kind: "video",
      contentType: null,
    })
    expect(parseStatus({ status: "completed", images: [{ url: "https://cdn/a.png" }] }, RID).output?.kind).toBe("image")
    // webhook envelope nests output under payload
    expect(parseStatus({ status: "completed", request_id: RID, payload: { video: { url: "https://cdn/w.mp4", content_type: "video/mp4" } } }, RID).output?.url).toBe(
      "https://cdn/w.mp4"
    )
    expect(parseStatus({ status: "nsfw", request_id: RID }, RID)).toMatchObject({ status: "nsfw", output: null })
    expect(parseStatus({ status: "failed", error: "Generation failed" }, RID)).toMatchObject({ status: "failed", error: "Generation failed" })
    expect(parseStatus({ status: "in_progress", video: { url: "https://cdn/partial" } }, RID).output).toBeNull()
  })

  it("estimates cost from the estimate endpoint", async () => {
    const { f, calls } = fakeFetch(() => json(200, { credits: "12.500", usd: "0.781" }))
    expect(await make(f).estimateCost("kling-video/v3.0/std/text-to-video", { prompt: "x", duration: 5 })).toEqual({ credits: 12.5, usd: 0.781 })
    expect(new URL(calls[0]!.url).pathname).toBe("/estimate/kling-video/v3.0/std/text-to-video")
  })

  it("cancels while queued and reports false once processing started", async () => {
    const ok = fakeFetch(() => new Response(null, { status: 202 }))
    expect(await make(ok.f).cancel({ requestId: RID })).toBe(true)
    expect(ok.calls[0]!.method).toBe("POST")
    const late = fakeFetch(() => json(400, { detail: "already processing" }))
    expect(await make(late.f).cancel({ requestId: RID })).toBe(false)
  })

  it("verifies a key with a status probe: 404 = valid, 401 = invalid", async () => {
    expect(await make(fakeFetch(() => json(404, { detail: "Not found" })).f).verifyCredentials()).toEqual({ ok: true })
    expect(await make(fakeFetch(() => json(401, { detail: "Invalid credentials" })).f).verifyCredentials()).toMatchObject({ ok: false })
  })

  it("downloads without the key, hashes the file and enforces a size limit", async () => {
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])
    const { f, calls } = fakeFetch(() => new Response(bytes, { status: 200, headers: { "content-type": "video/mp4" } }))
    const file = await make(f).downloadResult("https://cdn.higgsfield.ai/out.mp4")
    expect(file.bytes).toBe(8)
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(calls[0]!.headers.authorization).toBeUndefined()
    await expect(make(f).downloadResult("https://cdn.higgsfield.ai/out.mp4", { maxBytes: 4 })).rejects.toThrow(/larger/)
    await expect(make(f).downloadResult("http://cdn.higgsfield.ai/out.mp4")).rejects.toThrow(/HTTPS/)
  })
})

describe("catalog parsing", () => {
  it("finds families and workflow pages", () => {
    expect(familyLinks('<a href="/docs/models/kling-3"> <a href="/docs/models/image-generation"> [x](/docs/models/kling-3/std.md)')).toEqual(["/docs/models/kling-3"])
    const fam = "| [Standard · Text to video](/docs/models/kling-3/standard-text-to-video) | `POST /kling-video/v3.0/std/text-to-video` |"
    expect(workflowLinks(fam, "/docs/models/kling-3")).toEqual(["/docs/models/kling-3/standard-text-to-video"])
  })

  it("reads the endpoint ID, title and the complete JSON schema", () => {
    const md = [
      "# Kling 3.0 — Standard · Text to video API",
      "**Endpoint ID:** `kling-video/v3.0/std/text-to-video`",
      "## Quick start",
      "```json",
      '{ "prompt": "not the schema" }',
      "```",
      '<Accordion title="Complete JSON schema">',
      "  ```json theme={}",
      '  { "type": "object", "properties": { "prompt": { "type": "string" }, "aspect_ratio": { "enum": ["16:9", "9:16"] } } }',
      "  ```",
    ].join("\n")
    const e = parseWorkflowPage(md, { family: "kling-3", outputKind: "video", docsUrl: "https://docs.higgsfield.ai/docs/models/kling-3/standard-text-to-video" })
    expect(e).toMatchObject({ id: "kling-video/v3.0/std/text-to-video", displayName: "Kling 3.0 — Standard · Text to video", workflow: "text-to-video" })
    expect(Object.keys(e!.inputSchema.properties)).toEqual(["prompt", "aspect_ratio"])
    expect(extractSchema("no schema here")).toBeNull()
  })
})
