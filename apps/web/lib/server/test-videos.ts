import "server-only"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

// Local development only: the Shorts made by `pnpm video:test`, read from test-videos/.
export const TEST_VIDEOS_DIR = path.resolve(process.cwd(), "../../test-videos")

export type TestVideo = {
  folder: string
  title: string
  hook: string
  captions: string[]
  scenes: number
  seconds: number
  madeAt: Date
}

export function listTestVideos(): TestVideo[] {
  if (!existsSync(TEST_VIDEOS_DIR)) return []
  return readdirSync(TEST_VIDEOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(TEST_VIDEOS_DIR, d.name, "final.mp4")))
    .map((d) => {
      const dir = path.join(TEST_VIDEOS_DIR, d.name)
      let plan: { title?: string; hook?: string; scenes?: { duration_sec: number; caption_words: string }[] } = {}
      try {
        plan = JSON.parse(readFileSync(path.join(dir, "plan.json"), "utf8"))
      } catch {
        // a run without a saved plan still shows its video
      }
      return {
        folder: d.name,
        title: plan.title ?? d.name,
        hook: plan.hook ?? "",
        captions: (plan.scenes ?? []).map((s) => s.caption_words),
        scenes: plan.scenes?.length ?? 0,
        seconds: (plan.scenes ?? []).reduce((t, s) => t + s.duration_sec, 0),
        madeAt: statSync(path.join(dir, "final.mp4")).mtime,
      }
    })
    .sort((a, b) => b.madeAt.getTime() - a.madeAt.getTime())
}
