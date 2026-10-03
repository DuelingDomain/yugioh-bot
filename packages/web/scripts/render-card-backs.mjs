// Renders the card back SVG sources to the WebP files the duel UI uses.
//   node packages/web/scripts/render-card-backs.mjs
// Source: public/duel/card-back-{main,extra}.svg (421x614). Output: card-back-{main,extra}-hd.webp (1394x2031).
// Needs `sharp` (hoisted from packages/bot or packages/shared).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "duel");
const WIDTH = 1394;
const HEIGHT = 2031;

for (const kind of ["main", "extra"]) {
  const svg = readFileSync(join(dir, `card-back-${kind}.svg`));
  // A high density makes the SVG rasterize near the target size; resize then sets the exact size.
  const out = await sharp(svg, { density: 72 * (WIDTH / 421) })
    .resize(WIDTH, HEIGHT, { fit: "fill" })
    .webp({ quality: 88, effort: 6 })
    .toBuffer();
  writeFileSync(join(dir, `card-back-${kind}-hd.webp`), out);
  console.log(`card-back-${kind}-hd.webp ${out.length} bytes`);
}
