import type { ModelInputSchema } from "@vidora/core"
import type { CatalogEntry } from "../video-provider"

// Reads Higgsfield's model catalog from its documentation (Markdown pages served by the docs site):
//   /docs/models/video-generation.md       → model families
//   /docs/models/<family>.md                → table of workflows: | [Title](/docs/models/<family>/<workflow>) | `POST /<endpoint>` |
//   /docs/models/<family>/<workflow>.md     → "**Endpoint ID:** `…`" and a "Complete JSON schema" block
// Each model keeps its own request schema; nothing is hardcoded. The docs need no API key.

type Fetch = typeof fetch
const DOCS = "https://docs.higgsfield.ai"

const CATEGORIES = [
  { path: "/docs/models/video-generation.md", outputKind: "video" as const },
  { path: "/docs/models/image-generation.md", outputKind: "image" as const },
]

const WORKFLOWS = [
  "text-to-video",
  "image-to-video",
  "reference-to-video",
  "video-to-video",
  "motion-transfer",
  "motion-control",
  "text-to-image",
  "image-to-image",
  "image-reference",
  "video-reference",
  "edit",
]

export async function fetchHiggsfieldCatalog(opts: { fetch?: Fetch; concurrency?: number; onError?: (url: string, err: unknown) => void } = {}) {
  const f = opts.fetch ?? fetch
  const get = async (path: string) => {
    // A plain (ref'd) timer: AbortSignal.timeout's timer doesn't keep Node alive, so a stalled
    // connection could otherwise leave a script waiting on nothing.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new Error(`Timed out reading ${path}`)), 30_000)
    try {
      const res = await f(new URL(path, DOCS), { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
      return await res.text()
    } finally {
      clearTimeout(timer)
    }
  }

  const families: { path: string; outputKind: CatalogEntry["outputKind"] }[] = []
  for (const c of CATEGORIES) {
    for (const fam of familyLinks(await get(c.path))) families.push({ path: fam, outputKind: c.outputKind })
  }

  const workflowPages: { path: string; family: string; outputKind: CatalogEntry["outputKind"] }[] = []
  await pool(families, opts.concurrency ?? 4, async (fam) => {
    try {
      const family = fam.path.split("/").pop()!
      for (const w of workflowLinks(await get(`${fam.path}.md`), fam.path)) workflowPages.push({ path: w, family, outputKind: fam.outputKind })
    } catch (err) {
      opts.onError?.(fam.path, err)
    }
  })

  const entries: CatalogEntry[] = []
  await pool(workflowPages, opts.concurrency ?? 4, async (w) => {
    try {
      const entry = parseWorkflowPage(await get(`${w.path}.md`), { family: w.family, outputKind: w.outputKind, docsUrl: `${DOCS}${w.path}` })
      if (entry) entries.push(entry)
    } catch (err) {
      opts.onError?.(w.path, err)
    }
  })
  return entries.sort((a, b) => a.id.localeCompare(b.id))
}

/** Family pages linked from a category page: /docs/models/<family> (one path segment, no .md). */
export function familyLinks(md: string): string[] {
  const out = new Set<string>()
  for (const m of md.matchAll(/(?:href="|\]\()(\/docs\/models\/[a-z0-9-]+)(?:"|\))/g)) out.add(m[1]!)
  return [...out].filter((p) => !p.endsWith("-generation"))
}

/** Workflow pages listed on a family page's endpoint table. */
export function workflowLinks(md: string, familyPath: string): string[] {
  const out = new Set<string>()
  const re = new RegExp(`\\]\\((${familyPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[a-z0-9-]+)\\)\\s*\\|\\s*\`POST`, "g")
  for (const m of md.matchAll(re)) out.add(m[1]!)
  return [...out]
}

export function parseWorkflowPage(
  md: string,
  ctx: { family: string; outputKind: CatalogEntry["outputKind"]; docsUrl: string }
): CatalogEntry | null {
  const id = /\*\*Endpoint ID:\*\*\s*`([^`]+)`/.exec(md)?.[1]
  if (!id) return null
  const title = /^#\s+(.+?)(?:\s+API)?\s*$/m.exec(md)?.[1]?.trim() ?? id
  const schema = extractSchema(md)
  if (!schema) return null
  const slug = ctx.docsUrl.split("/").pop() ?? ""
  return {
    id,
    family: ctx.family,
    displayName: title,
    workflow: WORKFLOWS.find((w) => slug.endsWith(w) || id.endsWith(w)) ?? slug,
    outputKind: ctx.outputKind,
    inputSchema: schema,
    docsUrl: ctx.docsUrl,
  }
}

/** The JSON block under "Complete JSON schema". Falls back to the first JSON block with `properties`. */
export function extractSchema(md: string): ModelInputSchema | null {
  const after = md.split(/Complete JSON schema/)[1] ?? md
  for (const block of after.matchAll(/```json[^\n]*\n([\s\S]*?)```/g)) {
    try {
      const j = JSON.parse(block[1]!) as ModelInputSchema
      if (j && typeof j === "object" && j.properties && typeof j.properties === "object") {
        return { type: "object", required: Array.isArray(j.required) ? j.required : [], properties: j.properties }
      }
    } catch {
      // not this block
    }
  }
  return null
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!)
    })
  )
}
