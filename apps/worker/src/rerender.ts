import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createDb, generationJobsForRun, getRun } from "@vidora/db"
import { createStorage, storageEnvFrom } from "@vidora/storage"
import { diskCache } from "./audio-assets"
import { renderShort } from "./render"
import { speakExpressive } from "./voice"

// Renders an existing run again from its stored scene clips, with the current narration, captions,
// music and effects. No new video credits (the voiceover uses ElevenLabs characters, not Higgsfield
// credits). The run and its posted video are left untouched.
//   pnpm video:rerender <runId> [--music "<mood>"]
// Output: test-videos/rerender-<runId>/final.mp4

const args = process.argv.slice(2)
const runId = args.find((a) => a.startsWith("run_"))
if (!runId) throw new Error('Usage: pnpm video:rerender <runId> [--music "<mood>"]')
const musicFlag = args.indexOf("--music") >= 0 ? args[args.indexOf("--music") + 1] : undefined

const db = createDb(process.env.DATABASE_URL, { max: 2 })
const storage = createStorage(storageEnvFrom(process.env))
const run = await getRun(db, runId)
if (!run?.plan) throw new Error(`Run ${runId} has no plan.`)
const outDir = path.resolve(process.cwd(), "../../test-videos", `rerender-${runId}`)
mkdirSync(outDir, { recursive: true })

const jobs = await generationJobsForRun(db, run.id)
const clips: string[] = []
for (const [i] of run.plan.scenes.entries()) {
  const stored = jobs.filter((j) => j.sceneIndex === i && j.status === "stored").sort((a, b) => b.attempt - a.attempt)[0]
  if (!stored?.storageKey) throw new Error(`Scene ${i + 1}'s clip is missing.`)
  const obj = await storage.get(stored.storageKey)
  writeFileSync(path.join(outDir, `scene-${i + 1}.mp4`), await obj.Body!.transformToByteArray())
  clips.push(`scene-${i + 1}.mp4`)
}

const result = await renderShort({
  workDir: outDir,
  plan: run.plan,
  clips,
  seed: run.id,
  musicMood: musicFlag ?? run.variation?.music_mood,
  voices: {
    elevenlabs: (line, voice) => speakExpressive(line, voice),
  },
  audioCache: diskCache(path.resolve(process.cwd(), "../../test-videos/_audio-cache")),
})
await db.close()
console.log(`Voice: ${JSON.stringify(result.voiceSource)}  Music mood: ${musicFlag ?? run.variation?.music_mood ?? "none"}`)
if (result.notes.length) console.log(`Notes: ${result.notes.join(" | ")}`)
console.log(`Done (${result.seconds.toFixed(1)} s): ${result.file}`)
