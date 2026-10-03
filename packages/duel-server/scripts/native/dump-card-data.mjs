// Dumps the card data nduel needs as plain text, because the native build has no sqlite headers.
//   node packages/duel-server/scripts/native/dump-card-data.mjs [--data data/duel-engine-next] [--out DIR]
// Writes DIR/cards.tsv (one line per card: code alias type level attribute race attack defense lscale rscale
// link_marker setcodes) and DIR/pool.txt (deck pool: "H|S|T|M code" curated hand/spell/trap/monster cards,
// "E code" curated Extra Deck cards, "m|s|x code" random main monster / spell-trap / extra cards that have a script
// or need none). Same rules as tests/fuzz/card-pool.ts (curated list copied from it).
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const require = createRequire(join(repo, "package.json"));
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dataDir = resolve(repo, opt("--data", "data/duel-engine-next"));
const outDir = resolve(repo, opt("--out", "packages/duel-server/domain-core/.build/nduel/data"));
mkdirSync(outDir, { recursive: true });

const T = { MONSTER: 0x1, SPELL: 0x2, TRAP: 0x4, NORMAL: 0x10, FUSION: 0x40, TOKEN: 0x4000, SYNCHRO: 0x2000, PENDULUM: 0x1000000, XYZ: 0x800000, LINK: 0x4000000, SKILL: 0x8000000, ACTION: 0x10000000 };
const EXTRA = T.FUSION | T.SYNCHRO | T.XYZ | T.LINK;
const CURATED = {
  H: [14558127, 23434538, 97268402, 59438930, 73642296, 94145021, 27204311, 42141493, 60643553, 14957440],
  S: [55144522, 12580477, 53129443, 83764718, 5318639, 19613556, 18144506, 72302403, 14087893, 81439173, 32807846, 73628505, 24224830, 8267140, 14532163, 35261759, 70368879, 49238328, 24094653, 1845204, 46052429, 55761792, 73915051, 43711255, 4031928, 17375316, 75500286, 12071500, 54631665, 86318356],
  T: [44095762, 53582587, 41420027, 84749824, 40605147, 29401950, 4206964, 94192409, 97077563, 10045474, 83326048, 15800838, 62279055, 77538567, 60082869, 98239899],
  M: [26202165, 78010363, 8131171, 83011277, 34124316, 54652250, 71413901, 77585513, 31786629, 44330098, 34853266, 40640057, 37742478, 60800381, 35809262, 5405694, 72426662, 10000020, 73640163, 68535320, 95929069, 17393207, 38033121, 25955164, 40044918, 23995346, 63845230, 16226786, 12014404, 46772449, 89631139, 46986414, 70781052, 21844576, 58932615],
  E: [35809262, 23995346],
};

const scripts = new Set();
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(join(dir, entry.name));
    else {
      const m = /^c(\d+)\.lua$/.exec(entry.name);
      if (m) scripts.add(Number(m[1]));
    }
  }
};
walk(join(dataDir, "card-scripts"));

const db = new Database(join(dataDir, "cards.cdb"), { readonly: true, fileMustExist: true });
db.defaultSafeIntegers(true);
const rows = db.prepare("SELECT id, alias, setcode, type, atk, def, level, race, attribute, ot FROM datas ORDER BY id").all();
db.close();

const lines = [];
const pool = { m: [], s: [], x: [] };
const known = new Set();
for (const r of rows) {
  const code = Number(r.id);
  const type = Number(r.type);
  const packed = Number(r.level);
  const link = (type & T.LINK) !== 0;
  const setcodes = [];
  for (let shift = 0n; shift < 64n; shift += 16n) {
    const v = Number((r.setcode >> shift) & 0xffffn);
    if (v) setcodes.push(v);
  }
  lines.push([code, Number(r.alias), type, packed & 0xff, Number(r.attribute), r.race.toString(), Number(r.atk), link ? 0 : Number(r.def), (packed >> 24) & 0xff, (packed >> 16) & 0xff, link ? Number(r.def) : 0, setcodes.join(",") || "-"].join("\t"));
  known.add(code);
  if (Number(r.alias) !== 0 || (Number(r.ot) & 3) === 0 || type & (T.TOKEN | T.SKILL | T.ACTION)) continue;
  const vanilla = (type & T.MONSTER) !== 0 && (type & T.NORMAL) !== 0 && !(type & (T.SPELL | T.TRAP | T.PENDULUM));
  if (!scripts.has(code) && !vanilla) continue;
  if (type & EXTRA) pool.x.push(code);
  else if (type & T.MONSTER) pool.m.push(code);
  else pool.s.push(code);
}
writeFileSync(join(outDir, "cards.tsv"), lines.join("\n") + "\n");
const poolLines = [];
for (const [key, list] of Object.entries(CURATED)) for (const id of list) if (known.has(id)) poolLines.push(`${key} ${id}`);
for (const [key, list] of Object.entries(pool)) for (const id of list) poolLines.push(`${key} ${id}`);
writeFileSync(join(outDir, "pool.txt"), poolLines.join("\n") + "\n");
console.log(`dump-card-data: ${lines.length} cards, pool m=${pool.m.length} s=${pool.s.length} x=${pool.x.length} -> ${outDir}`);
