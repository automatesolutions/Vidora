import { describe, expect, it } from "vitest"
import type { StructuredCall, StructuredRequest } from "./claude"
import type { DirectorInput } from "./context"
import { createDirector } from "./director"
import { NicheStudySchema, type NicheStudy } from "./schemas"

// The niche-source step: web fetch first, and for app-style sites (content drawn by JavaScript)
// the browser-rendered text from the worker.

const input: DirectorInput = {
  brief: { campaignName: "Kumpooni", mode: "original", topic: "Shorts about https://kumpooni.com/ for people who pay for repairs", targetLengthSec: 15 },
  variation: { script_angle: "relatable moment" },
  model: { id: "kling-video/v3.0/std/text-to-video", displayName: "Kling 3.0", durations: [3, 4, 5], promptMaxChars: 2500, supportsNegativePrompt: false },
  history: { hooks: [], titles: [], concepts: [] },
  postDate: "Friday, 23 October 2026",
}

const study = (read_ok: boolean): NicheStudy => ({
  read_ok,
  pages_read: read_ok ? ["https://kumpooni.com/"] : [],
  brand_name: read_ok ? "Kumpooni" : "",
  niche: "",
  audience: "",
  problem: "",
  brand_tone: "",
  sections: [],
  offerings: [],
  benefits: [],
  offers: [],
  proof: [],
  faqs: [],
  cta: "",
  visual_cues: "",
  not_on_page: "",
})

const STOP = new Error("stop after the study step")

/** Fake Claude: answers study requests from a queue, then stops the run at ideation. */
function fake(answers: NicheStudy[]) {
  const requests: StructuredRequest<unknown>[] = []
  const call: StructuredCall = async <T>(req: StructuredRequest<T>) => {
    requests.push(req as StructuredRequest<unknown>)
    if ((req.schema as unknown) !== NicheStudySchema) throw STOP
    return { data: answers.shift() as T, model: "claude-opus-5-5", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
  }
  return { call, requests }
}

const PAGE = "Your repairs have a memory now. Save the quote, the photos, and every visit. ".repeat(5)

describe("niche source study", () => {
  it("studies the browser-rendered text when web fetch can't read an app-style site", async () => {
    const { call, requests } = fake([study(false), study(true)])
    const rendered: string[] = []
    const director = createDirector(call, { renderPage: async (url) => (rendered.push(url), PAGE) })
    await expect(director.planRun(input)).rejects.toBe(STOP) // reached ideation: the study succeeded
    expect(rendered).toEqual(["https://kumpooni.com/"])
    expect(requests[0]!.webFetch?.domain).toBe("kumpooni.com")
    expect(requests[1]!.webFetch).toBeUndefined()
    expect(requests[1]!.context).toContain("<page_text>")
    expect(requests[1]!.context).toContain("Your repairs have a memory now.")
    expect(requests[2]!.context).toContain("Kumpooni") // the ideation context carries the study
  })

  it("still fails clearly when the rendered page is an empty shell or can't render", async () => {
    for (const renderPage of [async () => "Kumpooni", async () => null, undefined]) {
      const { call } = fake([study(false), study(true)])
      await expect(createDirector(call, { renderPage }).planRun(input)).rejects.toThrow(/Couldn't read https:\/\/kumpooni.com\//)
    }
  })
})
