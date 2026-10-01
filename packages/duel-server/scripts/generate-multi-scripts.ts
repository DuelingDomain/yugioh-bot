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
 */
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
export const EXPECTED_COUNTS = { compare: 54, chooser: 44, whole: 7, entries: 100, r1: 92 } as const;

export type Helper = "MPAny" | "MPValue" | "MPOne" | "MPPick" | "MPTarget";
export type CardClass = "COMPARE" | "CHOOSER";

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
  if (manifest.cards.length !== EXPECTED_COUNTS.entries) problems.push(`${manifest.cards.length} entries, expected ${EXPECTED_COUNTS.entries}`);
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
  const check = process.argv.includes("--check");
  const result = run({ check });
  for (const file of result.written) console.log(`wrote ${file}`);
  if (result.r1 !== undefined) console.log(`R1 count (Mirror Gate excluded): ${result.r1}`);
  for (const problem of result.problems) console.error(`problem: ${problem}`);
  console.log(result.problems.length === 0 ? (check ? "multi-scripts overlay: ok" : `done, ${result.written.length} files written`) : `${result.problems.length} problem(s)`);
  process.exit(result.problems.length === 0 ? 0 : 1);
}
