import { describe, expect, it } from "vitest"
import { assColor, buildAss, chunkWords } from "./captions"
import { alignWords, estimateWords, performanceLine, stripTags } from "./voice"

const w = (text: string, start: number) => ({ text, start, end: start + 0.3 })

describe("captions", () => {
  it("converts hex colors to ASS order", () => {
    expect(assColor("#FFD60A")).toBe("&H000AD6FF")
  })

  it("chunks at three words, long chunks, and punctuation", () => {
    const chunks = chunkWords([w("Three", 0), w("AI", 0.3), w("jobs.", 0.6), w("Number", 1), w("one", 1.3), w("surprised", 1.6), w("me", 2)])
    expect(chunks.map((c) => c.map((x) => x.text).join(" "))).toEqual(["Three AI jobs.", "Number one", "surprised me"])
  })

  it("writes one event per spoken word with the active word highlighted, plus the hook title", () => {
    const ass = buildAss({
      hookTitle: { text: "3 AI side jobs", end: 2.4 },
      scenes: [{ start: 0, end: 4, caption: "3 AI jobs", words: [w("Three", 2.5), w("AI", 2.9), w("jobs.", 3.3)] }],
    })
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"))
    expect(events.filter((e) => e.includes(",Caption,"))).toHaveLength(3)
    expect(events[1]).toContain("{\\c&H000AD6FF&\\fscx108\\fscy108}AI{")
    expect(events.find((e) => e.includes(",Hook,"))).toContain("3 AI SIDE JOBS")
  })

  it("holds word captions until the hook text is gone, so there's one block of text at a time", () => {
    const ass = buildAss({
      hookTitle: { text: "She quit. Here's how", end: 2 },
      scenes: [{ start: 0, end: 4, caption: "", words: [w("I", 0.1), w("quit", 0.5), w("my", 1.9), w("job.", 2.2)] }],
    })
    const captions = ass.split("\n").filter((l) => l.includes(",Caption,"))
    expect(captions.every((e) => e.startsWith("Dialogue: 1,0:00:02."))).toBe(true)
    expect(captions.some((e) => e.includes("JOB."))).toBe(true)
  })

  it("falls back to the scene's key words when there are no timings", () => {
    const ass = buildAss({ scenes: [{ start: 3, end: 6, caption: "Look far away", words: [] }] })
    expect(ass).toContain("Dialogue: 1,0:00:03.00,0:00:06.00,Caption")
    expect(ass).toContain("LOOK FAR AWAY")
  })
})

describe("voice helpers", () => {
  it("strips audio tags and keeps a tagged line only when its words match", () => {
    expect(stripTags("[excited] Hi there. [whispers] Wait.")).toBe("Hi there. Wait.")
    expect(performanceLine({ purpose: "hook", voiceover_line: "Hi there. Wait.", voiceover_performance: "[excited] Hi there. [whispers] Wait." })).toBe("[excited] Hi there. [whispers] Wait.")
    expect(performanceLine({ purpose: "hook", voiceover_line: "Hi there.", voiceover_performance: "[excited] Hello there." })).toBe("[excited] Hi there.")
  })

  it("aligns script words to transcript times, and estimates without them", () => {
    expect(alignWords(["Hi", "there"], [{ start: 0.1, end: 0.3 }, { start: 0.4, end: 0.7 }])[1]).toEqual({ text: "there", start: 0.4, end: 0.7 })
    const est = estimateWords(["a", "bb", "ccc"], 3)
    expect(est[0]!.start).toBeCloseTo(0.1)
    expect(est.at(-1)!.end).toBeCloseTo(2.75)
  })
})
