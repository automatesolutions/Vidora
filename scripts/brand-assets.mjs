// Builds every derived Vidora brand asset from the master logo.
// Usage: pnpm brand
// Source: assets/vidora-logo.png (never modified). Outputs: apps/web/public/brand/* and apps/web/app/{favicon.ico,icon.svg,apple-icon.png,opengraph-image.png}
//
// The master PNG has no alpha channel, so the logo is traced to vector with potrace
// (mark and wordmark separately) and every PNG size is rendered from that SVG.
// Colors and the gradient axis were fitted from the master's pixels (see .claude/skills/vidora-design/SKILL.md §2).

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import potrace from "potrace";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "assets/vidora-logo.png");
const BRAND = path.join(root, "apps/web/public/brand");
const APP = path.join(root, "apps/web/app");

const UPSCALE = 4;
const COLORS = {
  gradStart: "#FD9A1B",
  gradEnd: "#FD4E4E",
  wordmark: "#28303A", // logo only, never UI text
  wordmarkDark: "#FFFEFB", // approved dark-mode variant (DESIGN.md on-primary)
  canvas: "#FFFEFB",
  ink: "#201515",
};
// Gradient axis fitted by least squares on the mark's solid pixels (master coordinates):
// direction 48.6deg below +x (CSS ~140deg), projection range t = 369.6 .. 612.9.
const GRAD_DIR = [Math.cos((48.6 * Math.PI) / 180), Math.sin((48.6 * Math.PI) / 180)];
const GRAD_T = [369.6, 612.9];

// Layer crops in master pixel coordinates (bbox measured from the master, plus margin).
const LAYERS = {
  mark: { left: 105, top: 375, width: 258, height: 232, channel: "blue", threshold: 152 },
  word: { left: 370, top: 408, width: 558, height: 154, channel: "luma", threshold: 150 },
};
const BOX = { full: { x: 107, y: 374, w: 818, h: 231 }, mark: { x: 107, y: 377, w: 254, h: 227 } };

async function layerPath({ left, top, width, height, channel, threshold }) {
  let img = sharp(SRC).extract({ left, top, width, height });
  img = channel === "blue" ? img.extractChannel("blue") : img.grayscale();
  const buf = await img
    .resize(width * UPSCALE, height * UPSCALE, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  const tracer = new potrace.Potrace();
  tracer.setParameters({ threshold, turdSize: 20, optTolerance: 0.2, alphaMax: 1, blackOnWhite: true });
  await new Promise((res, rej) => tracer.loadImage(buf, (err) => (err ? rej(err) : res())));
  const d = tracer.getPathTag().match(/ d="([^"]+)"/)[1];
  return `<path transform="translate(${left} ${top}) scale(${1 / UPSCALE})" fill-rule="evenodd" d="${d}"`;
}

function gradientDef(id) {
  const [dx, dy] = GRAD_DIR;
  const [t0, t1] = GRAD_T;
  const f = (n) => n.toFixed(2);
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(t0 * dx)}" y1="${f(t0 * dy)}" x2="${f(t1 * dx)}" y2="${f(t1 * dy)}"><stop offset="0" stop-color="${COLORS.gradStart}"/><stop offset="1" stop-color="${COLORS.gradEnd}"/></linearGradient>`;
}

function svg({ box, mark, word, wordColor, title, background }) {
  const bg = background ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${background}"/>` : "";
  const wordTag = word ? `${word} fill="${wordColor}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" role="img" aria-label="${title}"><title>${title}</title><defs>${gradientDef("vidora-gradient")}</defs>${bg}${mark} fill="url(#vidora-gradient)"/>${wordTag}</svg>\n`;
}

// Square icon: mark centered on a solid square, mark width = `scale` of the side.
function squareIconSvg({ mark, side, scale, background }) {
  const b = BOX.mark;
  const size = Math.max(b.w, b.h) / scale;
  const x = b.x + b.w / 2 - size / 2;
  const y = b.y + b.h / 2 - size / 2;
  const bg = background ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="${x} ${y} ${size} ${size}"><defs>${gradientDef("g")}</defs>${bg}${mark} fill="url(#g)"/></svg>`;
}

const png = (svgText, width) => sharp(Buffer.from(svgText), { density: 300 }).resize({ width }).png({ compressionLevel: 9 }).toBuffer();

function ico(pngs) {
  // ICO container with embedded PNG images (supported by every current browser).
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

// Renders the light SVG over white at master scale and compares it with the master inside the logo box.
async function fidelity(svgText) {
  const { x, y, w, h } = BOX.full;
  const master = await sharp(SRC).extract({ left: x, top: y, width: w, height: h }).raw().toBuffer();
  const traced = await sharp(Buffer.from(svgText))
    .resize(w, h)
    .flatten({ background: "#fefefe" })
    .removeAlpha()
    .raw()
    .toBuffer();
  let sum = 0;
  let bad = 0;
  for (let i = 0; i < master.length; i += 3) {
    const diff = Math.max(...[0, 1, 2].map((c) => Math.abs(master[i + c] - traced[i + c])));
    sum += diff;
    if (diff > 64) bad++;
  }
  const px = master.length / 3;
  return { meanDiff: (sum / px).toFixed(2), badPct: ((bad / px) * 100).toFixed(2) };
}

async function main() {
  await mkdir(BRAND, { recursive: true });
  const mark = await layerPath(LAYERS.mark);
  const word = await layerPath(LAYERS.word);

  const light = svg({ box: BOX.full, mark, word, wordColor: COLORS.wordmark, title: "Vidora" });
  const dark = svg({ box: BOX.full, mark, word, wordColor: COLORS.wordmarkDark, title: "Vidora" });
  const markOnly = svg({ box: BOX.mark, mark, title: "Vidora" });

  const files = {
    "vidora-logo.svg": light,
    "vidora-logo-dark.svg": dark,
    "vidora-mark.svg": markOnly,
    "vidora-logo.png": await png(light, 1600),
    "vidora-logo-dark.png": await png(dark, 1600),
    "vidora-logo-email.png": await png(light, 1200), // 600px wide @2x for email headers
    "vidora-mark.png": await png(markOnly, 512),
    "app-icon-1024.png": await png(squareIconSvg({ mark, side: 1024, scale: 0.62, background: COLORS.canvas }), 1024),
    "app-icon-dark-1024.png": await png(squareIconSvg({ mark, side: 1024, scale: 0.62, background: COLORS.ink }), 1024),
    "icon-192.png": await png(squareIconSvg({ mark, side: 192, scale: 0.62, background: COLORS.canvas }), 192),
    "icon-512.png": await png(squareIconSvg({ mark, side: 512, scale: 0.62, background: COLORS.canvas }), 512),
    // Maskable icons keep the mark inside the central 80% safe zone.
    "icon-maskable-512.png": await png(squareIconSvg({ mark, side: 512, scale: 0.5, background: COLORS.canvas }), 512),
  };
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(BRAND, name), data);
  await copyFile(SRC, path.join(BRAND, "vidora-logo-original.png"));

  // Next.js metadata files
  const favSizes = [16, 32, 48];
  const favs = await Promise.all(
    favSizes.map(async (size) => ({ size, data: await png(squareIconSvg({ mark, side: size, scale: 0.92 }), size) })),
  );
  await writeFile(path.join(APP, "favicon.ico"), ico(favs));
  await writeFile(path.join(APP, "icon.svg"), squareIconSvg({ mark, side: 32, scale: 0.92 }).replace(/ width="32" height="32"/, ""));
  await writeFile(path.join(APP, "apple-icon.png"), await png(squareIconSvg({ mark, side: 180, scale: 0.62, background: COLORS.canvas }), 180));

  // Default social image: logo on the warm canvas, brand gradient as a thin bottom band.
  const og = await sharp({ create: { width: 1200, height: 630, channels: 4, background: COLORS.canvas } })
    .composite([
      { input: await png(light, 640), gravity: "center" },
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="12"><defs><linearGradient id="b"><stop offset="0" stop-color="${COLORS.gradStart}"/><stop offset="1" stop-color="${COLORS.gradEnd}"/></linearGradient></defs><rect width="1200" height="12" fill="url(#b)"/></svg>`,
        ),
        top: 618,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  await writeFile(path.join(APP, "opengraph-image.png"), og);
  await writeFile(path.join(APP, "opengraph-image.alt.txt"), "Vidora logo");
  await writeFile(path.join(BRAND, "og-default.png"), og);

  const f = await fidelity(light);
  console.log(`Wrote ${Object.keys(files).length + 2} brand files and 5 app metadata files.`);
  console.log(`Trace fidelity vs master: mean channel diff ${f.meanDiff}/255, pixels off by >64: ${f.badPct}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
