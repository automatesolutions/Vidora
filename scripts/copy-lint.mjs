// Flags banned words in user-facing copy (JSX text and string literals) under apps/web.
// Usage: pnpm copy-lint
// Word list: apps/web/lib/banned-words.json. Silence one line with a `copy-lint-ignore` comment.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "apps/web");
const { words, labels } = JSON.parse(await readFile(path.join(web, "lib/banned-words.json"), "utf8"));
const SCAN = ["app", "components", "lib", "emails"];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = new RegExp(`\\b(${words.map(escape).join("|")})\\b`, "i");
const labelRe = new RegExp(`^\\s*(${labels.map(escape).join("|")})\\s*$`); // exact button labels, case-sensitive

async function* files(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(tsx|ts|mdx)$/.test(e.name)) yield p;
  }
}

// Pieces of copy on a line: JSX text between tags, and quoted strings that read like prose.
function copyPieces(line) {
  const pieces = [];
  for (const m of line.matchAll(/>([^<>{}]+)</g)) pieces.push(m[1]);
  for (const m of line.matchAll(/(["'`])((?:(?!\1).)*)\1/g)) {
    const text = m[2];
    const isClassList = /^[\w\-:[\]/().%#&*>!,=@ ]+$/.test(text) && /(^|\s)[a-z]+-[\w-[\]/.]+/.test(text);
    if (!isClassList) pieces.push(text);
  }
  return pieces;
}

const problems = [];
for (const dir of SCAN) {
  for await (const file of files(path.join(web, dir))) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes("copy-lint-ignore") || /^\s*(\/\/|\*|\/\*|import )/.test(line)) return;
      for (const piece of copyPieces(line)) {
        const hit = piece.match(wordRe) ?? piece.match(labelRe);
        if (hit) problems.push(`${path.relative(root, file)}:${i + 1}  "${hit[1]}"  in: ${piece.trim().slice(0, 80)}`);
      }
    });
  }
}

if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`\n${problems.length} banned word(s) in UI copy. See .claude/skills/vidora-design/SKILL.md §7.`);
  process.exit(1);
}
console.log("Copy lint passed: no banned words in UI copy.");
