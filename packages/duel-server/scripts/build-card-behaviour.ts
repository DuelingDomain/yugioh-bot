/**
 * Builds the Remote Duels card behaviour table from the engine data (cards.cdb and the Lua scripts): what each card does to the board
 * (hand quick effect, costs, detach, attach, where it sends itself and other cards). See card-behaviour-scan.ts for the rules.
 * Output: packages/web/src/lib/remote/card-behaviour-data.json (inert data: the engine data publisher only accepts JSON).
 * Run: npx tsx packages/duel-server/scripts/build-card-behaviour.ts [--check]. Update it with the weekly engine-data bump.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packCardBehaviour, type CardBehaviour } from "@yugidraft/shared/remote/card-behaviour";
import { scanScript } from "./card-behaviour-scan.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DUEL_DATA_DIR ?? join(here, "../../../data/duel-engine"));
const out = join(here, "../../web/src/lib/remote/card-behaviour-data.json");

// Fusion, Synchro, Xyz and Link monsters go back to the Extra Deck, never the Deck.
const EXTRA_DECK_TYPES = 0x40 | 0x2000 | 0x800000 | 0x4000000;
const PENDULUM = 0x1000000;
const db = new Database(join(dataDir, "cards.cdb"), { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT id, alias, type FROM datas").all() as { id: number; alias: number; type: number }[];
const aliases = new Map<number, number[]>();
for (const r of rows) if (r.alias) aliases.set(r.alias, [...(aliases.get(r.alias) ?? []), r.id]);
db.close();

const dirs = ["official", "pre-release", "prerelease"].map(d => join(dataDir, "card-scripts", d)).filter(existsSync);
const read = (id: number) => { for (const d of dirs) { const p = join(d, `c${id}.lua`); if (existsSync(p)) return readFileSync(p, "utf8"); } return undefined; };
/** The script of a card. A stub that only loads another script (Duel.LoadCardScriptAlias / LoadCardScript) is that other script. */
const script = (id: number, depth = 0): string | undefined => {
  const text = read(id);
  const stub = text && text.split("\n").filter(line => line.trim() && !line.startsWith("--")).length <= 2 ? /Duel\.LoadCardScript(?:Alias)?\(\s*(?:"c(\d+)\.lua"|(\d+)|(CARD_POLYMERIZATION))\s*\)/.exec(text) : null;
  return stub && depth < 2 ? script(Number(stub[1] ?? stub[2] ?? 24094653), depth + 1) ?? text : text;
};

const records = new Map<number, CardBehaviour>();
const stats = { scripts: 0, withBehaviour: 0, handQuick: 0, cost: 0, costOther: 0, detach: 0, attach: 0, leaves: 0, sends: 0, banishDown: 0, draws: 0, partial: 0 };
for (const { id, type, alias } of rows) {
  // Alt arts take the record of the card they alias, unless they have a script of their own (then they are a different card).
  const text = script(id); if (!text) continue;
  stats.scripts++;
  const record = scanScript(text, { extraDeckMonster: (type & EXTRA_DECK_TYPES) !== 0, pendulum: (type & PENDULUM) !== 0 });
  if (!Object.keys(record).length) continue;
  stats.withBehaviour++;
  if (record.handQuick) stats.handQuick++;
  if (record.cost) stats.cost++;
  if (record.costOther) stats.costOther++;
  if (record.detach) stats.detach++;
  if (record.attach) stats.attach++;
  if (record.leaves) stats.leaves++;
  if (record.sends) stats.sends++;
  if (record.leaves?.some(l => l.to === "banishDown") || record.sends?.some(s => s.to === "banishDown") || record.cost?.includes("banishDown")) stats.banishDown++;
  if (record.partial) stats.partial++;
  if (record.draws) stats.draws++;
  records.set(id, record);
  for (const a of aliases.get(id) ?? []) if (!script(a)) records.set(a, record);
}

// Canonical JSON (2-space indent, final newline): scripts/ci/publish-engine-data.mjs checks the exact bytes. SHAPES = the distinct
// behaviours, IDS = the card ids of each, base 36 and delta coded (see packages/shared/src/remote/card-behaviour.ts).
const body = JSON.stringify(packCardBehaviour(records), null, 2) + "\n";
// --check: CI fails when the committed file is out of date for the prepared engine data. Nothing is written.
if (process.argv.includes("--check")) {
  if (!existsSync(out) || readFileSync(out, "utf8") !== body) {
    console.error("card-behaviour-data.json is out of date. Run: npx tsx packages/duel-server/scripts/build-card-behaviour.ts");
    process.exit(1);
  }
  console.log("card-behaviour-data.json is up to date");
  process.exit(0);
}
writeFileSync(out, body);
console.log(JSON.stringify(stats), "ids", records.size, "bytes", body.length);
