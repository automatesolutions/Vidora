// Fails when any required token pair drops below its WCAG AA minimum, in light or dark mode.
// Usage: pnpm contrast
// Reads token values straight from apps/web/app/globals.css, so the check follows the real CSS.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(path.join(root, "apps/web/app/globals.css"), "utf8");
const { pairs } = JSON.parse(await readFile(path.join(root, "apps/web/lib/contrast-pairs.json"), "utf8"));

function block(selectorRegex) {
  const m = css.match(selectorRegex);
  if (!m) throw new Error(`Block not found: ${selectorRegex}`);
  const vars = {};
  for (const [, name, value] of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[name] = value.trim();
  return vars;
}

const palette = block(/@theme\s*\{([\s\S]*?)\n\}/);
const modes = {
  light: { ...palette, ...block(/:root\s*\{([\s\S]*?)\n\}/) },
  dark: { ...palette, ...block(/\.dark\s*\{([\s\S]*?)\n\}/) },
};

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const resolve = (vars, token) => {
  const value = vars[token];
  if (!value) throw new Error(`Token ${token} is not defined`);
  const hex = value.match(/#[0-9a-f]{6}\b/i);
  if (!hex) throw new Error(`Token ${token} is not a 6-digit hex (${value})`);
  return hex[0].toLowerCase();
};

let failures = 0;
const rows = [];
for (const pair of pairs) {
  for (const mode of pair.mode ? [pair.mode] : ["light", "dark"]) {
    const fg = resolve(modes[mode], pair.fg);
    const bg = resolve(modes[mode], pair.bg);
    const r = ratio(fg, bg);
    const ok = r >= pair.min;
    if (!ok) failures++;
    rows.push(`${ok ? "pass" : "FAIL"}  ${mode.padEnd(5)}  ${r.toFixed(2).padStart(5)} >= ${pair.min}  ${fg} on ${bg}  ${pair.use}`);
  }
}
console.log(rows.join("\n"));
console.log(failures ? `\n${failures} pair(s) below WCAG AA.` : `\nAll ${rows.length} pairs pass WCAG AA.`);
process.exit(failures ? 1 : 0);
