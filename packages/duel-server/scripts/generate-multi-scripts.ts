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
 *   npx tsx scripts/generate-multi-scripts.ts --register-r1 FILE.json
 *                  read-modify-write: adds the R1 entries `[{ "code": 1, "name": "..." }]` to MANIFEST.json (sorted by code, stockSha256
 *                  from the stock script) and leaves every other entry as it is. A card that is listed already is skipped.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
export const EXPECTED_COUNTS = { compare: 54, chooser: 44, whole: 7, entries: 103, r1: 92 } as const;
/**
 * R1 cards whose stock script already acts on every living duelist after core patch 0053, so they need no suffix and no entry.
 * Pinned (a card is added here only after the script was read). Empty when every R1 card has a suffix.
 */
export const R1_NO_CHANGE: number[] = [];
/** True when every one of the 92 R1 cards is an entry or a member of R1_NO_CHANGE (the strict count check). */
export const R1_COMPLETE = false;

export type Helper = "MPAny" | "MPValue" | "MPOne" | "MPPick" | "MPTarget";
export type CardClass = "COMPARE" | "CHOOSER" | "R1";

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
  const compare = sorted(manifest.cards.filter((card) => card.classes.includes("COMPARE")).map((card) => card.code));
  const chooser = sorted(manifest.cards.filter((card) => card.classes.includes("CHOOSER") && !COMPARE_EXTRA.includes(card.code)).map((card) => card.code));
  const whole = manifest.cards.filter((card) => card.kind === "whole");
  if (compare.length !== EXPECTED_COUNTS.compare) problems.push(`COMPARE has ${compare.length} cards, expected ${EXPECTED_COUNTS.compare}`);
  if (chooser.length !== EXPECTED_COUNTS.chooser) problems.push(`CHOOSER has ${chooser.length} cards, expected ${EXPECTED_COUNTS.chooser}`);
  if (whole.length !== EXPECTED_COUNTS.whole) problems.push(`${whole.length} whole files, expected ${EXPECTED_COUNTS.whole}`);
  const overlayEntries = manifest.cards.filter((card) => !card.classes.includes("R1"));
  if (overlayEntries.length !== EXPECTED_COUNTS.entries) problems.push(`${overlayEntries.length} entries, expected ${EXPECTED_COUNTS.entries}`);
  const r1Entries = manifest.cards.filter((card) => card.classes.includes("R1"));
  for (const card of r1Entries) {
    if (card.kind !== "hand") problems.push(`R1 card ${card.code} has kind ${card.kind}, expected hand`);
    if (card.classes.length !== 1) problems.push(`R1 card ${card.code} has another class besides R1`);
    if (R1_NO_CHANGE.includes(card.code)) problems.push(`R1 card ${card.code} has an entry and is in R1_NO_CHANGE`);
  }
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
    const entry = r1Entry(item.code, item.name, readFileSync(join(stockDirectory, `c${item.code}.lua`), "utf8"));
    if (item.note) entry.note = item.note;
    manifest.cards.push(entry);
    added.push(item.code);
  }
  manifest.cards.sort((a, b) => a.code - b.code);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return added;
}

export interface RunResult {
  written: string[];
  problems: string[];
  r1?: number;
}

/** Writes (or, with `check`, only compares) the `whole` files, then checks the lists and the files of the manifest. */
export function run(options: { check: boolean; directory?: string; triage?: Triage[] | null }): RunResult {
  const directory = options.directory ?? OVERLAY_DIRECTORY;
  const manifest = readManifest(directory);
  const triage = options.triage === undefined ? readTriage() : options.triage;
  const problems = checkLists(manifest, triage);
  const written: string[] = [];
  for (const card of manifest.cards) {
    const path = join(directory, card.file);
    if (card.kind === "whole") {
      const text = wholeFileText(card);
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
  const registerAt = process.argv.indexOf("--register-r1");
  if (registerAt >= 0) {
    const stockDirectory = process.env.DUEL_SCRIPTS_DIR ?? join(process.env.DUEL_DATA_DIR ?? "", "card-scripts/official");
    const items = JSON.parse(readFileSync(process.argv[registerAt + 1], "utf8")) as { code: number; name: string; note?: string }[];
    console.log(`registered ${JSON.stringify(registerR1(items, stockDirectory))}`);
    process.exit(0);
  }
  const check = process.argv.includes("--check");
  const result = run({ check });
  for (const file of result.written) console.log(`wrote ${file}`);
  if (result.r1 !== undefined) console.log(`R1 count (Mirror Gate excluded): ${result.r1}`);
  for (const problem of result.problems) console.error(`problem: ${problem}`);
  console.log(result.problems.length === 0 ? (check ? "multi-scripts overlay: ok" : `done, ${result.written.length} files written`) : `${result.problems.length} problem(s)`);
  process.exit(result.problems.length === 0 ? 0 : 1);
}
