/**
 * Builds the Remote Duels card-logic id lists from the engine data (cards.cdb type bits and the Lua scripts).
 * Output: packages/web/src/lib/remote/card-logic-data.json (inert data: the engine data publisher only accepts JSON). Run: npx tsx packages/duel-server/scripts/build-card-logic.ts
 * The lists are small and ship with the web bundle. Update them with the weekly engine-data bump.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DUEL_DATA_DIR ?? join(here, "../../../data/duel-engine"));
const out = join(here, "../../web/src/lib/remote/card-logic-data.json");

const TYPE_MONSTER = 0x1, TYPE_SPELL = 0x2, TYPE_TRAP = 0x4, TYPE_EQUIP = 0x40000, TYPE_UNION = 0x400;
const db = new Database(join(dataDir, "cards.cdb"), { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT id, alias, type FROM datas").all() as { id: number; alias: number; type: number }[];
const typeOf = new Map(rows.map(r => [r.id, r.type]));
const aliases = new Map<number, number[]>();
for (const r of rows) if (r.alias) aliases.set(r.alias, [...(aliases.get(r.alias) ?? []), r.id]);
db.close();

const dirs = ["official", "pre-release", "prerelease"].map(d => join(dataDir, "card-scripts", d)).filter(existsSync);
const script = (id: number) => { for (const d of dirs) { const p = join(d, `c${id}.lua`); if (existsSync(p)) return readFileSync(p, "utf8"); } return undefined; };

// Duel.Equip(player, equip card, target): the 2nd argument is the card that gets equipped. `c` is the script's own card.
// Card.EquipByEffect*(host, e, tp, equip card, ...) (also written host:EquipByEffect*(e, tp, equip card)) equips the 4th card TO the host (utility.lua).
const SELF = String.raw`(?:c|e:GetHandler\(\))`;
const isSelf = (text: string) => new RegExp(`^${SELF}$`).test(text.trim());
const duelEquip = new RegExp(String.raw`Duel\.Equip\(\s*[^,()]+,\s*([\w.:()]+?)\s*,`, "g");
const methodEquip = /(?:\b([\w.]+(?:\(\))?):|\bCard\.)EquipByEffect\w*\(/g;
/** The top-level arguments of the call that opens just before `from`. */
function argsAt(text: string, from: number): string[] {
  const args: string[] = []; let depth = 0, start = from;
  for (let i = from; i < text.length && i < from + 400; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") { if (depth === 0) { args.push(text.slice(start, i)); return args; } depth--; }
    else if (ch === "," && depth === 0) { args.push(text.slice(start, i)); start = i + 1; }
  }
  return args;
}
/** What a script equips: its own card to another monster (`self`), or another monster to some host (`other`). */
function equips(text: string) {
  let self = false, other = false;
  for (const m of text.matchAll(duelEquip)) { if (isSelf(m[1])) self = true; else other = true; }
  for (const m of text.matchAll(methodEquip)) {
    const args = argsAt(text, m.index! + m[0].length);
    const host = m[1] ?? args.shift() ?? "", equipped = args[2] ?? "";
    if (isSelf(equipped) && !isSelf(host)) self = true; else if (!isSelf(equipped)) other = true;
  }
  return { self, other };
}
// Control: Duel.GetControl(card, player, ...) gives the card to `player`. Giving it to the opponent (1-tp, 1-p: Mimighoul) is not taking control.
const getControl = /Duel\.GetControl\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*([^,()]+)/g;
const otherControl = /\bDuel\.SwapControl\(|CATEGORY_CONTROL|EFFECT_SET_CONTROL/;
/** Cards that only return control to the owner: Owner's Seal, Release Brainwashing. They are not "take control". */
const GIVES_BACK = new Set([9720537, 85395151]);
const takesControl = (text: string) => {
  const calls = [...text.matchAll(getControl)].map(m => m[1].trim());
  if (calls.length) return calls.some(player => !/^1\s*-\s*(?:tp|p)$/.test(player));
  return otherControl.test(text);
};
const reviveOpp = /Duel\.(?:SelectTarget|IsExistingTarget|SelectMatchingCard)\([^\n]*(?:LOCATION_GRAVE\s*,\s*LOCATION_GRAVE|\b0\s*,\s*LOCATION_GRAVE)/;

const sets = { selfEquip: new Set<number>(), equippers: new Set<number>(), takeControl: new Set<number>(), reviveOpponent: new Set<number>() };
const add = (set: Set<number>, id: number) => { set.add(id); for (const a of aliases.get(id) ?? []) set.add(a); };
for (const [id, type] of typeOf) {
  if (type & TYPE_UNION) add(sets.selfEquip, id);
  const text = script(id); if (!text) continue;
  const monster = (type & TYPE_MONSTER) !== 0, equipSpell = (type & TYPE_SPELL) !== 0 && (type & TYPE_EQUIP) !== 0;
  const found = equips(text);
  if (monster && found.self) add(sets.selfEquip, id);
  if (!equipSpell && found.other) add(sets.equippers, id);
  if (!GIVES_BACK.has(id) && takesControl(text)) add(sets.takeControl, id);
  if (/CATEGORY_SPECIAL_SUMMON/.test(text) && reviveOpp.test(text) && (type & (TYPE_SPELL | TYPE_TRAP)) !== 0) add(sets.reviveOpponent, id);
}

const pack = (set: Set<number>) => [...set].sort((a, b) => a - b).map(n => n.toString(36)).join(" ");
// Canonical JSON (2-space indent, final newline): scripts/ci/publish-engine-data.mjs checks the exact bytes. Keys:
// SELF_EQUIP (monsters that equip themselves as an Equip Card), EQUIPPERS (cards that equip another monster to a monster),
// TAKE_CONTROL (cards that take or swap control), REVIVE_OPPONENT_GY (Spells and Traps that revive from either Graveyard).
const body = JSON.stringify({ SELF_EQUIP: pack(sets.selfEquip), EQUIPPERS: pack(sets.equippers), TAKE_CONTROL: pack(sets.takeControl), REVIVE_OPPONENT_GY: pack(sets.reviveOpponent) }, null, 2) + "\n";
// --check: CI fails when the committed file is out of date for the prepared engine data. Nothing is written.
if (process.argv.includes("--check")) {
  if (!existsSync(out) || readFileSync(out, "utf8") !== body) {
    console.error("card-logic-data.json is out of date. Run: npx tsx packages/duel-server/scripts/build-card-logic.ts");
    process.exit(1);
  }
  console.log("card-logic-data.json is up to date");
  process.exit(0);
}
writeFileSync(out, body);
console.log(Object.entries(sets).map(([k, v]) => `${k}: ${v.size}`).join(", "), "bytes", body.length);
