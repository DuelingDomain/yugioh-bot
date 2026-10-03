/**
 * Generator and checker of the multi-player card overlay (F7 design, part P3a).
 *
 *   npx tsx scripts/generate-multi-scripts.ts            write the `whole` files from MANIFEST.json
 *   npx tsx scripts/generate-multi-scripts.ts --check    write nothing; exit 1 when a file differs or a list is wrong
 *
 * A `whole` card needs one line: its MANIFEST entry names the function and the helper (`wrap: { MPAny: ["spcon"] }`),
 * and this script writes `cNNN.lua` from it. The other kinds (`expr`, `trig`, `hand`, `chooser`, `fix`) are written by hand
 * from the stock script and only checked here (file exists, listed once).
 *
 * The lists are pinned in this file. When the triage file (.status/multiplayer-triage.json, not in git) is present, the
 * lists are also compared with it:
 *   COMPARE (54) = triage group `field-count-compare` (51) minus 6 false positives, plus Evenly Matched and Pineapple Blast,
 *                  plus 7 cards of the scan gap (COMPARE_SCAN_ADDED, in other triage groups).
 *   CHOOSER (44) = triage rule starting with `CHOOSER`.
 *   R1 (92)      = triage rule starting with `EACH-DUELIST` or `SCRIPT`, minus Mirror Gate 43452193 (it belongs to Q7).
 *                  An R1 card is a MANIFEST entry of class `R1` (kind `hand`: a suffix that loops with aux.MPForEachDuelist) or a
 *                  member of R1_NO_CHANGE (the stock script already acts on every living duelist). The R1 entries are not part of
 *                  the pinned `entries` count (that count is the compare and chooser entries, in other agents' lists).
 *
 *   R2 (seat state) = a MANIFEST entry of class `R2`: kind `seat` (written here: the per-player tables of the stock script are moved to
 *                  one slot per seat in FFA and per team in Tag, see seatFileText) or kind `hand` (a suffix written by hand). A card
 *                  whose stock script works as it is after core patch 0053 is a member of R2_NO_CHANGE. The R2 entries are not part of
 *                  the pinned `entries` count either.
 *
 *   ATTACK (a direct attack at you) = a MANIFEST entry of class `ATTACK`, kind `hand`: "when an opponent's monster declares a direct attack"
 *                  holds in FFA only when the attack goes to the duelist that holds the card (aux.MPAttackedAtMe wraps the stock
 *                  condition; an inline condition is a `--@replace` file). Not part of the pinned `entries` count either.
 *
 *   npx tsx scripts/generate-multi-scripts.ts --register-attack FILE.json
 *                  read-modify-write: adds or replaces the ATTACK entries (items as AttackItem, see registerAttack).
 *   npx tsx scripts/generate-multi-scripts.ts --register-r2 FILE.json
 *                  read-modify-write: adds or replaces the R2 entries (items as R2Item, see registerR2); run the generator again to write
 *                  the files of the `seat` entries.
 *   npx tsx scripts/generate-multi-scripts.ts --register-r1 FILE.json
 *                  read-modify-write: adds the R1 entries `[{ "code": 1, "name": "..." }]` to MANIFEST.json (sorted by code, stockSha256
 *                  from the stock script) and leaves every other entry as it is. A card that is listed already is skipped.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The hand-written parts of the generated `seat` files (seatExtra). They are not loaded by the duel: their text is copied into the files. */
export const SEAT_SOURCE_DIRECTORY = join(PACKAGE_DIR, "domain-core", "multi-scripts-src");
export const OVERLAY_DIRECTORY = join(PACKAGE_DIR, "domain-core", "multi-scripts");
export const TRIAGE_FILE = resolve(PACKAGE_DIR, "..", "..", ".status", "multiplayer-triage.json");

/**
 * Cards that the scan rule field-count-compare flags but that need no one-opponent window. 35059553 Kaiser Colosseum: both
 * functions are continuous values (EFFECT_MAX_MZONE, EFFECT_UNRELEASABLE_SUM) with no activation, no window and no chooser;
 * the "opponent" is the controller of the card in the value call.
 */
export const COMPARE_FALSE_POSITIVES = [16191953, 22512406, 24175232, 35059553, 60623203, 70916046, 82693917];
/** Real COMPARE cards that the triage does not list as `field-count-compare` (it groups a card by one primary group). */
export const COMPARE_SCAN_ADDED = [25388971, 46772449, 50838440, 55273560, 62015408, 80551022, 89883517];
/** Compare AND chooser cards that the triage does not list as `field-count-compare`. */
export const COMPARE_EXTRA = [15693423, 90669991];
export const MIRROR_GATE = 43452193;
export const EXPECTED_COUNTS = { compare: 54, chooser: 44, whole: 7, entries: 195, r1: 92, attack: 59 } as const;
/**
 * R1 cards whose stock script already acts on every living duelist after core patch 0053, so they need no suffix and no entry.
 * Pinned (a card is added here only after the script was read). 39513225 only sends a Confirm to the opponent (no effect on each duelist).
 * (76895648 Dangerous Machine Type-6 is an entry: its hand and draw results need the pick of one opponent at activation, R-COMMON-OPP-PICK.)
 */
export const R1_NO_CHANGE: number[] = [39513225];
/**
 * R2 cards whose stock script works as it is after core patch 0053: the flag is written for the real seat by a global effect and read
 * with the player value of the holder, and the core keys a flag by seat in FFA and by team in Tag. Pinned (a card is added here only
 * after the script was read). A card is never an R2 entry and also in this list.
 */
export const R2_NO_CHANGE: number[] = [
  4064925, 5063379, 7903368, 8700633, 12275533, 12958919, 13567610, 18969888, 19271881, 20822520, 25388971, 26285788, 27275398,
  29948294, 31472884, 31699677, 33393090, 34800281, 35756798, 41850466, 52875873, 54475145, 55273560, 55795155, 57995165,
  67100549, 69145169, 71612253, 75906310, 82570174, 84211599, 84544192, 85523502, 86541496, 88513608, 88851326, 89948817,
  91269402, 92536468, 93039339, 93238626, 95134948, 95515789, 99748883,
];
/**
 * R2_NO_CHANGE cards that keep a known, accepted difference from the 2 player text in FFA (review B, area seats). The card stays in the list
 * (a fix would need a per-seat key read in a player-target condition, which the script cannot do) and the difference is recorded here.
 *  - 88851326 Legacy of the Duelist: the Set lock of the opponent side (target range 0,1, setcon2) reads the flag of "1-handler", so in FFA the
 *    flag of one opponent (it Set one card from the hand this turn) locks the Set of every opponent. The flag resets at the End Phase and a Set
 *    from the hand happens in the own turn, so the effect is small. Tag is exact (the flag is keyed by team, one opposing team).
 */
export const R2_ACCEPTED_DEVIATIONS: Record<number, string> = {
  88851326: "FFA: the Set flag of one opponent locks the Set from the hand of every opponent (reset at the End Phase)",
};
/** True when every one of the 92 R1 cards is an entry or a member of R1_NO_CHANGE (the strict count check). */
export const R1_COMPLETE = true;

export type Helper = "MPAny" | "MPValue" | "MPOne" | "MPPick" | "MPTarget" | "MPAttackedAtMe";
/** ATTACK: "when an opponent's monster declares a direct attack" (the attack must go to the duelist that holds the card). */
export type CardClass = "COMPARE" | "CHOOSER" | "R1" | "R2" | "ATTACK";
/** The kind of seat state that the stock script of an R2 card keeps (a short tag for the note and the report). */
export type R2Class =
  | "TABLE" // a per-player table or counter (s[tp], s.list[ep]): one slot per seat (FFA) or team (Tag)
  | "TABLE-CUSTOM" // the same, with a layout that needs its own code
  | "EVENT-BITS" // a custom event whose value names the players (0, 1, PLAYER_ALL)
  | "FLAG-L0" // a global flag that is written for player 0 and read by the holder: it is written for every seat
  | "LITERAL" // a global effect that compares a player or a controller with 0 or 1
  | "LABEL" // a label that keeps 1-tp for a monster that can belong to any opponent
  | "LOOP" // a loop over the players 0 and 1
  | "EACH-CONTROLLER"; // the effect acts on the real controller of each card

export interface ManifestCard {
  code: number;
  file: string;
  kind: string;
  name: string;
  classes: CardClass[];
  /** Effect types that carry the changed function (`SPSUMMON_PROC`, `TRIGGER_O`, `ACTIVATE`, ...). */
  effectType?: string;
  /** Functions (or `inline`) in which the compare lives. */
  compareIn?: string[];
  /** Helper -> functions wrapped as `s.fn=aux.Helper(s.fn)`. */
  wrap?: Partial<Record<Helper, string[]>>;
  /** Functions written again in full in the suffix. */
  redefined?: string[];
  /** The file starts with `--@replace`. */
  replace?: boolean;
  chooserClass?: string;
  /** R2 entries: the kind of seat state. */
  r2Class?: R2Class;
  /** Kind `seat`: the per-player tables of the stock script (`s`, `s.name_list`, ...). Slot 0 and 1 of each move to one slot per seat/team. */
  seatTables?: string[];
  /** Kind `seat`: a Lua expression of the empty value of a slot (`0`, `false`, `{}`). Default `0`. */
  seatInit?: string;
  /** Kind `seat`: stock functions that clear the table (they run in a global effect or in a handler): `{ name: returnExpr | null }`. */
  seatResets?: Record<string, string | null>;
  /** Kind `seat`: a Lua file in domain-core/multi-scripts-src whose text is put before the initial_effect wrapper (a hand-written part). */
  seatExtra?: string;
  /** Kind `seat`: the tables are not made again at the turn end (the stock script keeps them for the whole duel). */
  seatNoReset?: boolean;
  stockSha256?: string;
  note?: string;
}

export interface Manifest {
  version: number;
  cards: ManifestCard[];
}

export function readManifest(directory = OVERLAY_DIRECTORY): Manifest {
  return JSON.parse(readFileSync(join(directory, "MANIFEST.json"), "utf8")) as Manifest;
}

/** The text of a `whole` file: the guard, one comment line, one wrap line per function. */
export function wholeFileText(card: ManifestCard): string {
  const lines = ["if not aux.MPAny then return end"];
  const wraps = Object.entries(card.wrap ?? {}) as [Helper, string[]][];
  if (wraps.length === 0) throw new Error(`card ${card.code} has kind whole but no wrap`);
  lines.push(`-- ${card.name}: ${card.note ?? "the compare asks if any one opponent passes (MPAny). Nothing else changes."}`);
  for (const [helper, names] of wraps) for (const name of names) lines.push(`s.${name}=aux.${helper}(s.${name})`);
  return lines.join("\n") + "\n";
}

/**
 * The text of a `seat` file (R2). A stock script keeps a counter or a flag per player in a table (`s[0]`, `s[1]`, `s.list[tp]`). A global
 * effect writes it with the REAL player (core patch 0053: a seat 0..3) and a handler reads it with its Lua player value (0 own, 1 the
 * bound opponent). The table gets one slot per key (aux.MPKey: the seat in FFA, the team in Tag) behind a metatable that maps the index
 * with aux.MPKey in the scope of the access. Every slot is made again by the stock reset functions named in `seatResets` (a stock reset
 * writes only s[0] and s[1]) and by aux.AddValuesReset at the turn end. A table is used for the players 0..3 only: a script that keeps
 * another value in s[2] or s[3] needs a hand suffix.
 */
export function seatFileText(card: ManifestCard, sourceDirectory = SEAT_SOURCE_DIRECTORY): string {
  const tables = card.seatTables ?? [];
  if (tables.length === 0) throw new Error(`card ${card.code} has kind seat but no seatTables`);
  const init = card.seatInit ?? "0";
  const lines = [
    "if not aux.MPKey then return end",
    `-- ${card.name}: ${card.note ?? "the per-player table has one slot per seat (FFA) or team (Tag), not only 0 and 1."}`,
    "local mp_resets={}",
    "local mp_stores={}",
    "-- the slot of a real seat (a value function gets a folded player value: use the seat of a card instead)",
    "function s.mp_slot(t,seat)",
    "\treturn mp_stores[t][aux.MPKeyOfSeat(seat)]",
    "end",
    "function s.mp_reset_all()",
    "\tfor _,f in ipairs(mp_resets) do f() end",
    "end",
    "local function mp_seat_table(t)",
    "\tlocal store={}",
    "\tlocal function reset()",
    `\t\tfor k=0,3 do store[k]=${init} end`,
    "\tend",
    "\treset()",
    "\tmp_stores[t]=store",
    "\trawset(t,0,nil)",
    "\trawset(t,1,nil)",
    "\tlocal old=getmetatable(t)",
    "\tlocal meta={}",
    "\tif old then for k,v in pairs(old) do meta[k]=v end end",
    "\tlocal old_index=old and old.__index",
    "\tlocal old_newindex=old and old.__newindex",
    "\tmeta.__index=function(self,k)",
    "\t\tif k==0 or k==1 or k==2 or k==3 then",
    "\t\t\tlocal key=aux.MPKey(k)",
    `\t\t\tif key>=0 then return store[key] end`,
    `\t\t\treturn ${init}`,
    "\t\tend",
    "\t\tif type(old_index)==\"function\" then return old_index(self,k) end",
    "\t\tif old_index then return old_index[k] end",
    "\tend",
    "\tmeta.__newindex=function(self,k,v)",
    "\t\tif k==0 or k==1 or k==2 or k==3 then",
    "\t\t\tlocal key=aux.MPKey(k)",
    "\t\t\tif key>=0 then store[key]=v end",
    "\t\telseif type(old_newindex)==\"function\" then",
    "\t\t\told_newindex(self,k,v)",
    "\t\telseif old_newindex then",
    "\t\t\told_newindex[k]=v",
    "\t\telse",
    "\t\t\trawset(self,k,v)",
    "\t\tend",
    "\tend",
    "\tsetmetatable(t,meta)",
    "\tmp_resets[#mp_resets+1]=reset",
    "end",
  ];
  for (const [name, ret] of Object.entries(card.seatResets ?? {})) {
    lines.push(`function s.${name}()`, "\ts.mp_reset_all()", ...(ret ? [`\treturn ${ret}`] : []), "end");
  }
  if (card.seatExtra) lines.push(readFileSync(join(sourceDirectory, card.seatExtra), "utf8").replace(/\n+$/, ""));
  lines.push(
    "local mp_ie=s.initial_effect",
    "function s.initial_effect(c)",
    "\tmp_ie(c)",
    "\tif s.mp_seat_ready then return end",
    "\ts.mp_seat_ready=true",
    ...tables.map((table) => `\tmp_seat_table(${table})`),
    ...(card.seatNoReset ? [] : ["\taux.AddValuesReset(s.mp_reset_all)"]),
    "end",
  );
  return lines.join("\n") + "\n";
}

export interface Triage {
  code: number;
  name: string;
  group: string;
  rule: string;
}

const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
const sorted = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b);

/** Lists of the manifest against the pinned counts and, when given, against the triage entries. Returns the problems. */
export function checkLists(manifest: Manifest, triage: Triage[] | null): string[] {
  const problems: string[] = [];
  const codes = manifest.cards.map((card) => card.code);
  if (new Set(codes).size !== codes.length) problems.push("a card is listed twice");
  for (const card of manifest.cards) if (!card.name || !card.name.trim()) problems.push(`card ${card.code} has an empty name (run the generator with DUEL_DATA_DIR to take it from the stock script)`);
  const compare = sorted(manifest.cards.filter((card) => card.classes.includes("COMPARE")).map((card) => card.code));
  const chooser = sorted(manifest.cards.filter((card) => card.classes.includes("CHOOSER") && !COMPARE_EXTRA.includes(card.code)).map((card) => card.code));
  const whole = manifest.cards.filter((card) => card.kind === "whole");
  if (compare.length !== EXPECTED_COUNTS.compare) problems.push(`COMPARE has ${compare.length} cards, expected ${EXPECTED_COUNTS.compare}`);
  if (chooser.length !== EXPECTED_COUNTS.chooser) problems.push(`CHOOSER has ${chooser.length} cards, expected ${EXPECTED_COUNTS.chooser}`);
  if (whole.length !== EXPECTED_COUNTS.whole) problems.push(`${whole.length} whole files, expected ${EXPECTED_COUNTS.whole}`);
  const overlayEntries = manifest.cards.filter((card) => !card.classes.includes("R1") && !card.classes.includes("R2") && !card.classes.includes("ATTACK"));
  if (overlayEntries.length !== EXPECTED_COUNTS.entries) problems.push(`${overlayEntries.length} entries, expected ${EXPECTED_COUNTS.entries}`);
  const r1Entries = manifest.cards.filter((card) => card.classes.includes("R1"));
  for (const card of r1Entries) {
    if (card.kind !== "hand") problems.push(`R1 card ${card.code} has kind ${card.kind}, expected hand`);
    if (card.classes.length !== 1) problems.push(`R1 card ${card.code} has another class besides R1`);
    if (R1_NO_CHANGE.includes(card.code)) problems.push(`R1 card ${card.code} has an entry and is in R1_NO_CHANGE`);
  }
  const r2Entries = manifest.cards.filter((card) => card.classes.includes("R2"));
  for (const card of r2Entries) {
    if (card.kind !== "hand" && card.kind !== "seat") problems.push(`R2 card ${card.code} has kind ${card.kind}, expected hand or seat`);
    if (card.classes.length !== 1) problems.push(`R2 card ${card.code} has another class besides R2`);
    if (!card.r2Class) problems.push(`R2 card ${card.code} has no r2Class`);
    if (card.kind === "seat" && !(card.seatTables && card.seatTables.length > 0)) problems.push(`R2 card ${card.code} has kind seat but no seatTables`);
    if (R2_NO_CHANGE.includes(card.code)) problems.push(`R2 card ${card.code} has an entry and is in R2_NO_CHANGE`);
  }
  const attackEntries = manifest.cards.filter((card) => card.classes.includes("ATTACK"));
  for (const card of attackEntries) {
    if (card.kind !== "hand") problems.push(`ATTACK card ${card.code} has kind ${card.kind}, expected hand`);
    if (card.classes.length !== 1) problems.push(`ATTACK card ${card.code} has another class besides ATTACK`);
    if (!card.replace && !(card.wrap?.MPAttackedAtMe && card.wrap.MPAttackedAtMe.length > 0)) problems.push(`ATTACK card ${card.code} has no MPAttackedAtMe wrap and is not a replace file`);
  }
  if (attackEntries.length !== EXPECTED_COUNTS.attack) problems.push(`ATTACK has ${attackEntries.length} cards, expected ${EXPECTED_COUNTS.attack}`);
  const r1Total = r1Entries.length + R1_NO_CHANGE.length;
  if (r1Total > EXPECTED_COUNTS.r1) problems.push(`R1 has ${r1Total} cards (entries and R1_NO_CHANGE), expected at most ${EXPECTED_COUNTS.r1}`);
  if (R1_COMPLETE && r1Total !== EXPECTED_COUNTS.r1) problems.push(`R1 has ${r1Total} cards (entries and R1_NO_CHANGE), expected ${EXPECTED_COUNTS.r1}`);
  if (!manifest.cards.some((card) => card.code === MIRROR_GATE && card.kind === "fix")) problems.push("Mirror Gate 43452193 is not listed with kind fix");
  if (triage) {
    const expectedCompare = sorted([
      ...triage.filter((entry) => entry.group === "field-count-compare" && !COMPARE_FALSE_POSITIVES.includes(entry.code)).map((entry) => entry.code),
      ...COMPARE_EXTRA,
      ...COMPARE_SCAN_ADDED,
    ]);
    if (!same(compare, expectedCompare)) problems.push(`COMPARE differs from the triage: ${diff(compare, expectedCompare)}`);
    const expectedChooser = sorted(triage.filter((entry) => entry.rule.startsWith("CHOOSER")).map((entry) => entry.code));
    if (!same(chooser, expectedChooser)) problems.push(`CHOOSER differs from the triage: ${diff(chooser, expectedChooser)}`);
    const r1 = r1Codes(triage);
    if (r1.length !== EXPECTED_COUNTS.r1) problems.push(`R1 has ${r1.length} cards, expected ${EXPECTED_COUNTS.r1}`);
    const listed = [...r1Entries.map((card) => card.code), ...R1_NO_CHANGE];
    const outside = listed.filter((code) => !r1.includes(code));
    if (outside.length > 0) problems.push(`R1 entries or R1_NO_CHANGE outside the triage R1 list: ${JSON.stringify(outside)}`);
    if (R1_COMPLETE) {
      const missing = r1.filter((code) => !listed.includes(code));
      if (missing.length > 0) problems.push(`R1 cards of the triage without entry: ${JSON.stringify(missing)}`);
    }
  }
  return problems;
}

/** R1 (each duelist): rule `EACH-DUELIST` or `SCRIPT`, without Mirror Gate (Q7). */
export function r1Codes(triage: Triage[]): number[] {
  return sorted(triage.filter((entry) => (entry.rule.startsWith("EACH-DUELIST") || entry.rule.startsWith("SCRIPT")) && entry.code !== MIRROR_GATE).map((entry) => entry.code));
}

function diff(actual: number[], expected: number[]): string {
  const extra = actual.filter((code) => !expected.includes(code));
  const missing = expected.filter((code) => !actual.includes(code));
  return `extra ${JSON.stringify(extra)}, missing ${JSON.stringify(missing)}`;
}

export function readTriage(file = TRIAGE_FILE): Triage[] | null {
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, "utf8")) as Triage[] | { entries: Triage[] };
  return Array.isArray(value) ? value : value.entries;
}

/**
 * The name of a card entry: the given name, or, when it is empty, the first line of the stock script (`--Name`). A card that is not in
 * cards.cdb (95200102, "Commande Duel JP002") has no other name source. Throws when there is none: an entry never has an empty name.
 */
export function cardName(code: number, name: string | undefined, stockDirectory: string): string {
  if (name && name.trim()) return name.trim();
  const first = readFileSync(join(stockDirectory, `c${code}.lua`), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const fromScript = /^--\s*([^@\s].*?)\s*$/.exec(first)?.[1];
  if (!fromScript) throw new Error(`card ${code} has no name: pass one, or the stock script needs the first line "--Name"`);
  return fromScript;
}

/**
 * Read-modify-write of MANIFEST.json: gives every entry with an empty name the name of its stock script (see cardName). Re-reads the
 * file right before the write. Returns the codes that got a name.
 */
export function fillMissingNames(stockDirectory: string, directory = OVERLAY_DIRECTORY): number[] {
  const manifest = readManifest(directory);
  const done: number[] = [];
  for (const card of manifest.cards) {
    if (card.name && card.name.trim()) continue;
    card.name = cardName(card.code, card.name, stockDirectory);
    done.push(card.code);
  }
  if (done.length > 0) writeFileSync(join(directory, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  return done;
}

/** The R1 entry of a card: kind hand, class R1, the stock hash. `stock` is the text of the stock script. */
export function r1Entry(code: number, name: string, stock: string): ManifestCard {
  return {
    code,
    file: `c${code}.lua`,
    name,
    kind: "hand",
    classes: ["R1"],
    stockSha256: createHash("sha256").update(stock).digest("hex"),
  };
}

/**
 * Read-modify-write of MANIFEST.json for the R1 entries: re-reads the file right before the write, adds the new entries and keeps the
 * list sorted by code (the other agents' entries stay as they are). Returns the codes that were added. `note` is a per-code text.
 */
export function registerR1(items: { code: number; name: string; note?: string }[], stockDirectory: string, directory = OVERLAY_DIRECTORY): number[] {
  const path = join(directory, "MANIFEST.json");
  const manifest = readManifest(directory);
  const added: number[] = [];
  for (const item of items) {
    if (manifest.cards.some((card) => card.code === item.code)) continue;
    if (!existsSync(join(directory, `c${item.code}.lua`))) throw new Error(`c${item.code}.lua is missing: write the suffix before registering the card`);
    const entry = r1Entry(item.code, cardName(item.code, item.name, stockDirectory), readFileSync(join(stockDirectory, `c${item.code}.lua`), "utf8"));
    if (readFileSync(join(directory, `c${item.code}.lua`), "utf8").startsWith("--@replace")) entry.replace = true;
    if (item.note) entry.note = item.note;
    manifest.cards.push(entry);
    added.push(item.code);
  }
  manifest.cards.sort((a, b) => a.code - b.code);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return added;
}

/** An ATTACK item of --register-attack: the stock condition functions to wrap, or none for a `--@replace` file (an inline condition). */
export interface AttackItem {
  code: number;
  name: string;
  /** The stock condition functions wrapped as `s.fn=aux.MPAttackedAtMe(s.fn)`; absent for a replace file. */
  wrap?: string[];
  note?: string;
}

/**
 * Read-modify-write of MANIFEST.json for the ATTACK entries (a direct attack must go to the holder of the card): re-reads the file right
 * before the write, adds or replaces the entries of the items and keeps the list sorted by code. The suffix (or replace) file must exist.
 * Returns the codes that were added or replaced.
 */
export function registerAttack(items: AttackItem[], stockDirectory: string, directory = OVERLAY_DIRECTORY): number[] {
  const path = join(directory, "MANIFEST.json");
  const manifest = readManifest(directory);
  const done: number[] = [];
  for (const item of items) {
    const file = join(directory, `c${item.code}.lua`);
    if (!existsSync(file)) throw new Error(`c${item.code}.lua is missing: write the file before registering the card`);
    const old = manifest.cards.find((card) => card.code === item.code);
    if (old && !old.classes.includes("ATTACK")) throw new Error(`card ${item.code} is a ${old.classes.join("+")} entry: it cannot also be ATTACK`);
    const entry: ManifestCard = {
      code: item.code,
      file: `c${item.code}.lua`,
      name: cardName(item.code, item.name, stockDirectory),
      kind: "hand",
      classes: ["ATTACK"],
      stockSha256: createHash("sha256").update(readFileSync(join(stockDirectory, `c${item.code}.lua`), "utf8")).digest("hex"),
    };
    if (item.wrap) {
      entry.wrap = { MPAttackedAtMe: item.wrap };
      entry.compareIn = item.wrap;
    } else {
      entry.compareIn = ["inline"];
    }
    if (readFileSync(file, "utf8").startsWith("--@replace")) entry.replace = true;
    if (item.note) entry.note = item.note;
    manifest.cards = manifest.cards.filter((card) => card.code !== item.code);
    manifest.cards.push(entry);
    done.push(item.code);
  }
  manifest.cards.sort((a, b) => a.code - b.code);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return done;
}

/** An R2 item of --register-r2: a `seat` card (the file is generated by `run`) or a `hand` card (the suffix exists already). */
export type R2Item = Pick<ManifestCard, "code" | "name" | "note" | "r2Class" | "seatTables" | "seatInit" | "seatResets" | "seatExtra" | "seatNoReset"> & { kind?: "seat" | "hand" };

/**
 * Read-modify-write of MANIFEST.json for the R2 entries (class R2, seat state): re-reads the file right before the write, adds or
 * replaces the entries of the items and keeps the list sorted by code. Returns the codes that were added or replaced. A `hand` item
 * needs its suffix file; the file of a `seat` item is written by `run` (npx tsx scripts/generate-multi-scripts.ts).
 */
export function registerR2(items: R2Item[], stockDirectory: string, directory = OVERLAY_DIRECTORY): number[] {
  const path = join(directory, "MANIFEST.json");
  const manifest = readManifest(directory);
  const done: number[] = [];
  for (const item of items) {
    const kind = item.kind ?? "seat";
    if (kind === "hand" && !existsSync(join(directory, `c${item.code}.lua`))) throw new Error(`c${item.code}.lua is missing: write the suffix before registering the card`);
    const old = manifest.cards.find((card) => card.code === item.code);
    if (old && !old.classes.includes("R2")) throw new Error(`card ${item.code} is a ${old.classes.join("+")} entry: it cannot also be R2`);
    const entry: ManifestCard = {
      code: item.code,
      file: `c${item.code}.lua`,
      name: cardName(item.code, item.name, stockDirectory),
      kind,
      classes: ["R2"],
      r2Class: item.r2Class,
      stockSha256: createHash("sha256").update(readFileSync(join(stockDirectory, `c${item.code}.lua`), "utf8")).digest("hex"),
    };
    if (item.note) entry.note = item.note;
    if (item.seatTables) entry.seatTables = item.seatTables;
    if (item.seatInit !== undefined) entry.seatInit = item.seatInit;
    if (item.seatResets) entry.seatResets = item.seatResets;
    if (item.seatExtra) entry.seatExtra = item.seatExtra;
    if (item.seatNoReset) entry.seatNoReset = true;
    manifest.cards = manifest.cards.filter((card) => card.code !== item.code);
    manifest.cards.push(entry);
    done.push(item.code);
  }
  manifest.cards.sort((a, b) => a.code - b.code);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return done;
}

export interface RunResult {
  written: string[];
  problems: string[];
  r1?: number;
}

/** Writes (or, with `check`, only compares) the `whole` files, then checks the lists and the files of the manifest. Without `check` and with a `stockDirectory`, an entry with an empty name first gets the name of its stock script. */
export function run(options: { check: boolean; directory?: string; triage?: Triage[] | null; stockDirectory?: string }): RunResult {
  const directory = options.directory ?? OVERLAY_DIRECTORY;
  if (!options.check && options.stockDirectory) fillMissingNames(options.stockDirectory, directory);
  const manifest = readManifest(directory);
  const triage = options.triage === undefined ? readTriage() : options.triage;
  const problems = checkLists(manifest, triage);
  const written: string[] = [];
  for (const card of manifest.cards) {
    const path = join(directory, card.file);
    if (card.kind === "whole" || card.kind === "seat") {
      const text = card.kind === "whole" ? wholeFileText(card) : seatFileText(card);
      const current = existsSync(path) ? readFileSync(path, "utf8") : null;
      if (current !== text) {
        if (options.check) problems.push(`${card.file} differs from the generated text`);
        else {
          writeFileSync(path, text);
          written.push(card.file);
        }
      }
    } else if (!existsSync(path)) {
      problems.push(`${card.file} is missing (kind ${card.kind} is written by hand)`);
    }
  }
  return { written, problems, r1: triage ? r1Codes(triage).length : undefined };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const registerR2At = process.argv.indexOf("--register-r2");
  if (registerR2At >= 0) {
    const stockDirectory = process.env.DUEL_SCRIPTS_DIR ?? join(process.env.DUEL_DATA_DIR ?? "", "card-scripts/official");
    const items = JSON.parse(readFileSync(process.argv[registerR2At + 1], "utf8")) as R2Item[];
    console.log(`registered ${JSON.stringify(registerR2(items, stockDirectory))}`);
    process.exit(0);
  }
  const registerAttackAt = process.argv.indexOf("--register-attack");
  if (registerAttackAt >= 0) {
    const stockDirectory = process.env.DUEL_SCRIPTS_DIR ?? join(process.env.DUEL_DATA_DIR ?? "", "card-scripts/official");
    const items = JSON.parse(readFileSync(process.argv[registerAttackAt + 1], "utf8")) as AttackItem[];
    console.log(`registered ${JSON.stringify(registerAttack(items, stockDirectory))}`);
    process.exit(0);
  }
  const registerAt = process.argv.indexOf("--register-r1");
  if (registerAt >= 0) {
    const stockDirectory = process.env.DUEL_SCRIPTS_DIR ?? join(process.env.DUEL_DATA_DIR ?? "", "card-scripts/official");
    const items = JSON.parse(readFileSync(process.argv[registerAt + 1], "utf8")) as { code: number; name: string; note?: string }[];
    console.log(`registered ${JSON.stringify(registerR1(items, stockDirectory))}`);
    process.exit(0);
  }
  const check = process.argv.includes("--check");
  const stockDirectory = process.env.DUEL_SCRIPTS_DIR ?? (process.env.DUEL_DATA_DIR ? join(process.env.DUEL_DATA_DIR, "card-scripts/official") : undefined);
  const result = run({ check, stockDirectory });
  for (const file of result.written) console.log(`wrote ${file}`);
  if (result.r1 !== undefined) console.log(`R1 count (Mirror Gate excluded): ${result.r1}`);
  for (const problem of result.problems) console.error(`problem: ${problem}`);
  console.log(result.problems.length === 0 ? (check ? "multi-scripts overlay: ok" : `done, ${result.written.length} files written`) : `${result.problems.length} problem(s)`);
  process.exit(result.problems.length === 0 ? 0 : 1);
}
