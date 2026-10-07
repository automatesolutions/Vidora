// Lists what still blocks a public launch. Fails until every item is resolved.
// Usage: pnpm launch-check
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const site = await readFile(path.join(root, "apps/web/lib/site.ts"), "utf8")
const problems = []

for (const [, key, value] of site.matchAll(/^\s+(\w+):\s*"(<[^"]+>)"/gm)) {
  problems.push(`apps/web/lib/site.ts: ${key} is still a placeholder (${value})`)
}

for (const page of ["privacy", "terms"]) {
  const src = await readFile(path.join(root, `apps/web/app/(marketing)/legal/${page}/page.tsx`), "utf8")
  if (src.includes("// DRAFT.")) problems.push(`legal/${page}: still marked DRAFT. Remove the marker after a lawyer reviews it.`)
}

const checklist = await readFile(path.join(root, "docs/platform-applications.md"), "utf8")
const open = [...checklist.matchAll(/^- \[ \] (.+)$/gm)].map((m) => m[1])
for (const item of open) problems.push(`docs/platform-applications.md: ${item}`)

if (problems.length) {
  console.log(problems.map((p) => `- ${p}`).join("\n"))
  console.log(`\n${problems.length} launch item(s) open.`)
  process.exit(1)
}
console.log("Launch check passed.")
