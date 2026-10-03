import Database from "better-sqlite3";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DuelAnswer, DuelFormat, DuelPrompt } from "@yugidraft/shared/duels";
import { seatCountFor } from "@yugidraft/shared/duels";
import {
  COMPARE_EXTRA, COMPARE_FALSE_POSITIVES, EXPECTED_COUNTS, MIRROR_GATE, OVERLAY_DIRECTORY, R1_NO_CHANGE, R2_NO_CHANGE, r1Codes, readManifest, readTriage,
  type CardClass, type Manifest, type Triage,
} from "../scripts/generate-multi-scripts.js";
import { scanCorpus, type CardScan } from "../scripts/scan-multiplayer-scripts.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { EngineAnswerError } from "../src/prompts.js";
import { compileBoard, type BoardSpec, type CardEntry, type DuelistSetup } from "../src/presets/board.js";
import { currentEngineDataDirectory, engineDataDirectory } from "./engine-data-dir.js";
import { planAnswer } from "./fuzz/answers.js";
import { Rng } from "./fuzz/rng.js";
import { CURRENT_MULTI_TAG, describeWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";

// F7 design section 5, row "Table": every card of the overlay lists on the real engine, at three seats and in Tag, on the DEBUG build
// of the core (-DYGO_N_TRAP). Each card must load without a Lua error, have its condition run, cause no trap `U` (a number read with no
// bound opponent) and no unexpected trap `c` (a bind in a place that cannot ask), and have the same class in MANIFEST.json and in the scan.
// A scan test also fails when a listed card reads overlay materials or counters on a field and has no MANIFEST entry.
//
// The debug core is not in git. Build it with
//   MULTI_TREE=<tree> OUT_NAME=ocgcore.multi-<tag>-trap.sync.wasm EXTRA_CXXFLAGS=-DYGO_N_TRAP scripts/build-multi-core.sh
// and put the file in domain-core/dist (the tag is CURRENT_MULTI_TAG of tests/support/cores.ts), or name it with TABLE_TRAP_WASM.
// NSEAT_WASM selects another real core (for example the installed Domain core); TABLE_TRAP_WASM takes precedence.
// Trap diagnostics are checked when the selected core emits them. The default remains the debug core.
// Without it the live table is skipped; with DUEL_REQUIRE_CORES=1 (CI, npm run test:engine) the missing file FAILS. CI builds it in the cores job.

const TRAP_WASM = process.env.TABLE_TRAP_WASM || process.env.NSEAT_WASM
  ? resolve((process.env.TABLE_TRAP_WASM ?? process.env.NSEAT_WASM)!)
  : fileURLToPath(new URL(`../domain-core/dist/ocgcore.multi-${CURRENT_MULTI_TAG}-trap.sync.wasm`, import.meta.url));
const trapWasm = needs.file("table multi core (default: -DYGO_N_TRAP)", TRAP_WASM, "Build it with EXTRA_CXXFLAGS=-DYGO_N_TRAP (see the head of tests/multi-scripts-table.test.ts), or set TABLE_TRAP_WASM or NSEAT_WASM.");

const overlayDirectory = process.env.TABLE_OVERLAY ? resolve(process.env.TABLE_OVERLAY) : OVERLAY_DIRECTORY;
const manifest = readManifest(overlayDirectory);
const stockDirectory = process.env.DUEL_SCRIPTS_DIR ?? join(currentEngineDataDirectory(), "card-scripts/official");
const stock = needs.file("official script corpus", stockDirectory, "Set DUEL_SCRIPTS_DIR, or set DUEL_DATA_DIR to an engine data directory with card-scripts/official.");
const stockText = (code: number) => readFileSync(join(stockDirectory, `c${code}.lua`), "utf8");

// ---------------------------------------------------------------------------------------------------------------------------------
// The table. A group is a list of codes. R1 (each duelist) and R2 groups are added here by the parts that write their overlay.
// ---------------------------------------------------------------------------------------------------------------------------------

export type TableGroup = "compare" | "chooser" | "r1" | "r2" | "fix";

export interface TableCard {
  code: number;
  group: TableGroup;
  name: string;
}

/**
 * Cards of a manifest by class, in the order compare, chooser, R1, R2, fix. A card of several classes (Evenly Matched, Pineapple
 * Blast) is listed once, in the first group. A "fix" entry has no class (a fix of one script that the scan does not flag) and is
 * listed in its own group. Mirror Gate is never listed (Q7).
 */
export function tableCardsOf(source: Manifest): TableCard[] {
  const rows: TableCard[] = [];
  const groups: [string, TableGroup][] = [["COMPARE", "compare"], ["CHOOSER", "chooser"], ["R1", "r1"], ["R2", "r2"]];
  for (const card of source.cards) {
    if (card.code === MIRROR_GATE) continue;
    const group = groups.find(([name]) => (card.classes as string[]).includes(name))?.[1] ?? (card.kind === "fix" ? "fix" : null);
    if (group) rows.push({ code: card.code, group, name: card.name || `c${card.code}` });
  }
  const order: TableGroup[] = ["compare", "chooser", "r1", "r2", "fix"];
  return rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

/** The name of a card from line 2 of its stock script (the English name), for the cards that have no MANIFEST entry. */
function scriptName(code: number): string {
  try {
    return stockText(code).split("\n")[1]?.replace(/^--\s*/, "").trim() || `c${code}`;
  } catch {
    return `c${code}`;
  }
}

/**
 * Cards of a group whose stock script needs no suffix (R1_NO_CHANGE) and so have no MANIFEST entry. The table still plays them: the
 * stock script must load and run at three seats and in Tag with no Lua error and no trap U or c.
 */
export function noChangeCards(group: "r1" | "r2", codes: readonly number[], listed: ReadonlySet<number>): TableCard[] {
  return codes.filter((code) => !listed.has(code)).map((code) => ({ code, group, name: scriptName(code) }));
}

const MANIFEST_ROWS = tableCardsOf(manifest);
const LISTED = new Set(MANIFEST_ROWS.map((row) => row.code));
const TABLE: TableCard[] = [...MANIFEST_ROWS, ...noChangeCards("r1", R1_NO_CHANGE, LISTED), ...noChangeCards("r2", R2_NO_CHANGE, LISTED)];

/**
 * Trap lines that a card causes on purpose, by code: the line kind. Empty today. Each entry needs a reason.
 */
const EXPECTED_TRAPS: Record<number, { kind: string; reason: string }[]> = {};

/**
 * Cards whose condition cannot run in this generic game, by code, with the reason. Empty entries are not allowed. The entry holds in
 * both formats unless NO_CONDITION_RUN_ONLY names the formats (the card runs its condition in the other one).
 */
const NO_CONDITION_RUN: Record<number, string> = {
  14220547: "Branded in Central Dogmatika: its Extra Deck trigger needs a Ritual Summon by a Spell; the generic table does not make one (p3-extra-deck.ts proves the real trigger, prompts and every seat in Standard and Domain)",
  1804528: "Dark Coffin: the trigger needs this card to be face-down on the field and destroyed; no generic seat destroys a set Trap",
  12247206: "Inferno Reckless Summon: the condition needs p0 to Special Summon exactly one weak monster while an opponent has a monster; the generic driver does not play it",
  36898537: "Metaphys Horus: the triggers need a Synchro Summon of this card; the generic game has no Synchro materials",
  // R1 and fix cards. Each is an event or Flip card; the live scenarios of the cards (tests/scenarios/multiplayer) play the event.
  12694768: "Abaki: the trigger is the destruction of this card by battle (EVENT_BATTLE_DESTROYED); the generic game does not destroy it in battle",
  58071123: "Oxygeddon: the trigger is the destruction of this card by battle (EVENT_BATTLE_DESTROYED); the generic game does not destroy it in battle",
  89731911: "Familiar Knight: the trigger is the destruction of this card by battle (EVENT_BATTLE_DESTROYED); in Tag the generic game does not destroy it in battle",
  39180960: "Rigorous Reaver: a Flip effect and a trigger on its destruction by battle; the generic game neither flips nor destroys it in battle",
  78706415: "Fiber Jar: a Flip effect (its only target function runs when the card is flipped); the generic game does not flip a Set monster",
  3549275: "Dice Jar: a Flip effect (its only target function runs when the card is flipped); the generic game does not flip a Set monster",
  40267580: "Brain Jacker: a Flip effect that equips, and a Standby Phase trigger of the equip; the generic game does not flip it",
  30109445: "Clown Crew Dristy: the target runs for a trigger on its own release (EVENT_RELEASE); at three seats the generic game does not release it (in Tag it does)",
  39767432: "Sorcerer of Sebek: triggers on battle damage (EVENT_BATTLE_DAMAGE) and on gaining Life Points (EVENT_RECOVER); at three and four seats the generic game has neither on its field (in Tag it has battle damage)",
  68078978: "Fortune Fairy Chee: triggers on being drawn (EVENT_DRAW from the hand) and on its own Special Summon; the generic game does neither",
  82734805: "Infernoid Tierra: triggers on its own Special Summon by its procedure; the generic game does not Special Summon it",
  96148285: "Triggered Summon: a Trap that waits for a Special Summon; no Special Summon of the generic game reaches its condition",
  23639291: "Raging Cloudian: a Trap on a custom event that a global watcher raises after a Cloudian monster is destroyed by its own effect; the generic game has no Cloudian (tests/scenarios/multiplayer/r2-checks.ts plays it)",
  5010422: "Prediction Princess Astromorrigan: a Flip effect whose only function is an End Phase operation registered at the flip (the table runs no operation); the generic game does not flip a Set monster",
  35059553: "Kaiser Colosseum: the card has no condition, target or cost function (only SetTargetRange values), so there is nothing for the table to see",
  18654201: "Criosphinx: hdtg runs on a custom event after a monster returns from the field to the hand; the generic game has no return effect (criosphinx.ts proves the event and every seat)",
  44155002: "The Fabled Unicore: its negate effect has only a continuous operation; its Synchro procedure needs a Fabled Tuner that the generic board does not have (fabled-unicore-counts.ts proves its operation and every seat)",
  54635100: "Linkerbell: its summon cost runs for a Link Summon with at least three more Extra Deck cards than an opponent; the generic board has only Linkerbell in the Extra Deck (opponent-count-gates.ts proves the summon and every seat)",
  59011257: "Fallin' Cheatah: ctrltg runs on a custom event after an opponent Special Summons a monster; no such event reaches it in the generic game (cheatah-controller.ts proves the event and every seat)",
  71315423: "Worm Millidith: eqtg runs on a Flip and damtg runs after it equips; the generic board starts it face-up and does not flip a Set monster (worm-table-p68.test.ts proves the equip, damage and every seat)",
  83819309: "Cooling Embers: its targets run after a duelist gains LP (EVENT_RECOVER); the generic game has no LP gain effect (cooling-embers.test.ts proves the trigger and every seat)",
  // R2 cards. Their global effects and flags load and run (no Lua error, no trap U or c); only a condition, target or cost never ran.
  3900605: "Absorbing Jar: the target is a Flip effect and the rest are continuous Summon and Set locks; the generic game does not flip a Set monster",
  18114794: "Summon Breaker: a Field Spell whose trigger is a custom event raised by a global effect after a Normal or Flip Summon; no such event reaches its condition",
  27770341: "Super Rejuvenation: a continuous Spell driven by EVENT_RELEASE, EVENT_DISCARD and the End Phase; the generic game gives none that reaches a function of the card",
  27769400: "Tualatin: a hand trigger on a custom event that a global check raises when ALL monsters of a duelist (2 or more at the start of the Battle Phase) are destroyed by battle; the generic game does not do it (tests/scenarios/multiplayer/r2-checks.ts plays it)",
  29724053: "Summon Gate: a continuous Spell with a Special Summon limit and a global counter of Special Summons; in Tag no function of the card runs in the generic game (at three seats the Spell does run)",
  32056070: "You and A.I.: a Continuous Spell whose trigger is a custom event raised by a global effect after a Special Summon; no such event reaches its target",
  51194046: "Qliphort Monolith: both effects work from the Pendulum Zone; the generic board has no Pendulum Zone",
  60018643: "Cynet Codec: a Continuous Spell whose trigger is a custom event raised by a global effect after a Special Summon; no such event reaches its target",
  65541655: "Red Nova Dragon - Burning Soul: the procedure needs two Tuners (or Red Dragon Archfiend) in the Monster Zone or Graveyard and a Synchro selection; the generic board has none",
  77910045: "Fatal Abacus: a Continuous Spell with one continuous effect on EVENT_TO_GRAVE and no condition, target or cost function",
  82670878: "Ogre of the Scarlet Sorrow: a hand trigger on a custom event raised by a global effect after an attack at a monster; the generic game does not raise it",
  83957459: "Rhinotaurus: an extra attack (condition) that is read for a monster that destroyed another by battle; the generic game does not destroy a monster by battle with it",
  83962752: "Synchro Panic: a Trap on a custom event raised by a global effect after a destruction; no such event reaches its condition",
  94585852: "Pandemonium: a Field Spell with an LP-cost replacement and a trigger on a custom event; the generic game pays no LP cost and raises no such event",
};
/** Formats where the NO_CONDITION_RUN entry holds (default both). */
const NO_CONDITION_RUN_ONLY: Record<number, DuelFormat[]> = { 89731911: ["tag"], 30109445: ["ffa3"], 29724053: ["tag"], 39767432: ["ffa3", "ffa4"] };

/**
 * Cards of the table that are not in cards.cdb of the engine data (the script exists, the card does not), by code, with the reason.
 * The engine cannot put such a card in a deck, so the table cannot play it. The test PASSES only while the card is absent.
 */
const NOT_IN_CARD_DATABASE: Record<number, string> = {
  39513225: "R1_NO_CHANGE card: the script is in card-scripts/official, the card is not in cards.cdb of data/duel-engine-next",
  95200102: "R1 entry: the script is in card-scripts/official, the card is not in cards.cdb of data/duel-engine-next",
  99505609: "R1 entry (Bingo Card): the script is in card-scripts/official, the card is not in cards.cdb of data/duel-engine-next",
  17242022: "R2 entry (Red-Eyes Black Dragon Exceed): the script is in card-scripts/official, the card is not in cards.cdb of data/duel-engine-next",
  77482666: "R2 entry (Swiftwind Panther Warrior): the script is in card-scripts/official, the card is not in cards.cdb of data/duel-engine-next",
};

/**
 * Faults that the table finds today in a card file or in the core, by code and format. They are not hidden: the test PASSES only
 * while the fault shows (a Lua error that matches `luaError`, or a trap line of kind `trap`), and FAILS when the fault is gone, so
 * the entry gets removed. The card files are not edited by the table agent; the fix belongs to the owner of the overlay.
 */
interface KnownGap {
  format: DuelFormat;
  luaError?: RegExp;
  trap?: string;
  reason: string;
}
const KNOWN_GAPS: Record<number, KnownGap[]> = {
};

function gapFor(code: number, format: DuelFormat): KnownGap | undefined {
  return KNOWN_GAPS[code]?.find((entry) => entry.format === format);
}

/** True when the run shows the symptom of the gap. */
export function showsGap(gap: KnownGap, run: Pick<RunResult, "luaError" | "traps">): boolean {
  if (gap.luaError && run.luaError && gap.luaError.test(run.luaError)) return true;
  return gap.trap !== undefined && run.traps.some((line) => new RegExp(`^NFOLD ${gap.trap} `).test(line));
}

const FORMATS: DuelFormat[] = ["ffa3", "tag"];
const TRAP_FAIL_KINDS = ["U", "c", "W"];

// ---------------------------------------------------------------------------------------------------------------------------------
// Scan checks (no engine).
// ---------------------------------------------------------------------------------------------------------------------------------

/** Classes of a card by the scan rules: COMPARE = field-count-compare, CHOOSER = a rule `chooser-*`. */
export function scanClasses(scan: Pick<CardScan, "rules">): CardClass[] {
  const classes: CardClass[] = [];
  if (scan.rules.includes("field-count-compare")) classes.push("COMPARE");
  if (scan.rules.some((rule) => rule.startsWith("chooser-"))) classes.push("CHOOSER");
  return classes;
}

/**
 * Cards whose class in the manifest is NARROWER than the scan class, by decision of the design (the scan has both rules, the
 * card needs one class): Gigantic Thundercross is a compare (its `chooser-opp` hit is a one-opponent read inside the compare);
 * Weighbridge and Vesper Girsu are choosers (the compare runs on the opponent that the chooser picks).
 */
export const CLASS_DECISIONS: Record<number, CardClass[]> = {
  34047456: ["COMPARE"],
  39103226: ["CHOOSER"],
  97345699: ["CHOOSER"],
};

/**
 * The scan class (U, C, O, F) that a listed card must have. Default O (one-opponent). Sangen Kaiho and Incredible Ecclesia are F:
 * they also keep a per-player flag in a global check (rule global-player-flag, a seat-state change that is not part of the compare
 * overlay). The overlay changes their compare only.
 */
export const SCAN_CLASS_OF: Record<number, CardScan["cls"]> = { 25388971: "F", 55273560: "F" };

/**
 * The scan classes that an R1 entry may have. The scan marks a card as U (no opponent read) or C (the fold is enough) when the stock
 * script needs no overlay, so such a card is never an R1 entry. Every R1 entry is O (an opponent read) or F.
 */
const R1_SCAN_CLASSES: CardScan["cls"][] = ["O", "F"];

/** Triage rules of another class: an R2 card is never listed under one of them. */
const NOT_R2_RULES = ["EACH-DUELIST", "SCRIPT", "CHOOSER"];

/**
 * Problems with the classes of the manifest against the scan of the stock scripts. An R1 entry must be in the triage R1 list (rule
 * EACH-DUELIST or SCRIPT) and have the scan class O or F. An R2 entry must have a scan class other than U (the scan sees a read of the
 * opponent or of a player) and must not be listed under the triage rules of R1 or the choosers (R2 also holds cards that the
 * triage did not list, found by reading the scripts; the triage is a local file and the triage checks are skipped without it).
 * A "fix" entry has no class and is not checked.
 */
export function classProblems(
  source: Manifest,
  scans: Map<number, CardScan>,
  falsePositives: readonly number[] = COMPARE_FALSE_POSITIVES,
  triage: readonly Triage[] | null = null,
): string[] {
  const problems: string[] = [];
  const r1 = triage ? new Set(r1Codes([...triage])) : null;
  const ruleOf = new Map((triage ?? []).map((entry) => [entry.code, entry.rule] as const));
  for (const card of source.cards) {
    if (card.kind === "fix") continue;
    // ATTACK (a direct attack at you) is not a scan class: the manifest test and the live scenarios check these entries.
    if ((card.classes as string[]).includes("ATTACK")) continue;
    const scan = scans.get(card.code);
    if (!scan) {
      problems.push(`${card.code} ${card.name}: not in the scan`);
      continue;
    }
    const rClasses = (card.classes as string[]).filter((name) => name === "R1" || name === "R2");
    if (rClasses.length > 0) {
      if (rClasses.includes("R1")) {
        if (r1 && !r1.has(card.code)) problems.push(`${card.code} ${card.name}: MANIFEST class R1, the triage has no R1 rule`);
        if (!R1_SCAN_CLASSES.includes(scan.cls)) problems.push(`${card.code} ${card.name}: MANIFEST class R1, scan class is ${scan.cls} (expected O or F)`);
      }
      if (rClasses.includes("R2")) {
        const rule = ruleOf.get(card.code);
        if (rule && NOT_R2_RULES.some((prefix) => rule.startsWith(prefix))) problems.push(`${card.code} ${card.name}: MANIFEST class R2, the triage rule is ${rule.split(":")[0]}`);
        if (scan.cls === "U") problems.push(`${card.code} ${card.name}: MANIFEST class R2, scan class is U (expected C, O or F)`);
      }
      continue;
    }
    const expected = CLASS_DECISIONS[card.code] ?? scanClasses(scan);
    if ([...card.classes].sort().join("+") !== [...expected].sort().join("+")) {
      problems.push(`${card.code} ${card.name}: MANIFEST class ${card.classes.join("+")}, scan class ${expected.join("+")}`);
    }
    const scanClass = SCAN_CLASS_OF[card.code] ?? "O";
    if (scan.cls !== scanClass) problems.push(`${card.code} ${card.name}: scan class is ${scan.cls}, expected ${scanClass}`);
  }
  const listed = new Set(source.cards.map((card) => card.code));
  for (const scan of scans.values()) {
    if (scan.rules.includes("field-count-compare") && !falsePositives.includes(scan.code) && !listed.has(scan.code)) {
      problems.push(`${scan.code} ${scan.name}: the scan flags a compare and the manifest has no entry`);
    }
  }
  return problems;
}

const OVERLAY_OR_COUNTER = /GetOverlayGroup|GetOverlayCount|:GetCounter\(|Duel\.GetCounter\(/;

/** Listed cards (codes) whose stock text reads overlay materials or counters and that have no MANIFEST entry. */
export function overlayReadersWithoutEntry(listed: Iterable<number>, source: Manifest, textOf: (code: number) => string): number[] {
  const entries = new Set(source.cards.map((card) => card.code));
  return [...listed].filter((code) => OVERLAY_OR_COUNTER.test(textOf(code)) && !entries.has(code)).sort((a, b) => a - b);
}

describeWithCores("the table: classes of the manifest against the scan", stock, () => {
  const scans = new Map(scanCorpus(stockDirectory).map((scan) => [scan.code, scan] as const));

  it("every listed card has the same class in MANIFEST.json and in the scan", () => {
    expect(classProblems(manifest, scans, COMPARE_FALSE_POSITIVES, readTriage())).toEqual([]);
  });

  it("the class check fails for a wrong class, a missing entry and a card that is not O", () => {
    const wrong = JSON.parse(JSON.stringify(manifest)) as Manifest;
    wrong.cards.find((card) => card.code === 93507434)!.classes = ["CHOOSER"];
    expect(classProblems(wrong, scans).join("\n")).toContain("93507434");
    const missing = JSON.parse(JSON.stringify(manifest)) as Manifest;
    missing.cards = missing.cards.filter((card) => card.code !== 25388971);
    expect(classProblems(missing, scans).join("\n")).toContain("25388971");
    expect(classProblems(manifest, new Map([...scans].map(([code, scan]) => [code, code === 93507434 ? { ...scan, cls: "C" as const } : scan] as const))).join("\n")).toContain("93507434");
  });

  it("every card of R1_NO_CHANGE and R2_NO_CHANGE has the scan class of its group (the stock script is read, no overlay)", () => {
    const card = (code: number, cls: CardClass) => ({ code, file: `c${code}.lua`, kind: "hand", name: scriptName(code), classes: [cls] });
    const noChange: Manifest = { version: 1, cards: [...R1_NO_CHANGE.map((code) => card(code, "R1")), ...R2_NO_CHANGE.map((code) => card(code, "R2" as CardClass))] };
    const codes = new Set(noChange.cards.map((entry) => entry.code));
    // Only the problems of these cards count (the manifest of no-change cards also lacks every compare card).
    const problems = classProblems(noChange, scans, COMPARE_FALSE_POSITIVES, readTriage()).filter((line) => codes.has(Number(line.split(" ")[0])));
    expect(problems).toEqual([]);
  });

  it("the class check fails for an R1 card that the triage does not list, and for an R1 card that the scan calls U or C", () => {
    const r1 = manifest.cards.find((card) => card.classes.includes("R1"));
    expect(r1, "the manifest has an R1 card").toBeDefined();
    const triage: Triage[] = [{ code: r1!.code, name: r1!.name, group: "x", rule: "EACH-DUELIST: x" }];
    const scan = scans.get(r1!.code)!;
    // Only the problems of this card count (a manifest of one card also lacks every other compare card).
    const problems = (source: Manifest, map: Map<number, CardScan>, list: readonly Triage[]) =>
      classProblems(source, map, COMPARE_FALSE_POSITIVES, list).filter((line) => line.startsWith(`${r1!.code} `));
    const only: Manifest = { version: 1, cards: [r1!] };
    expect(problems(only, scans, triage)).toEqual([]);
    expect(problems(only, scans, []).join("\n")).toContain("the triage has no R1 rule");
    expect(problems(only, new Map([[r1!.code, { ...scan, cls: "C" as const }]]), triage).join("\n")).toContain("expected O or F");
    const r2: Manifest = { version: 1, cards: [{ ...r1!, classes: ["R2" as CardClass] }] };
    expect(problems(r2, scans, triage).join("\n")).toContain("the triage rule is EACH-DUELIST");
    expect(problems(r2, new Map([[r1!.code, { ...scan, cls: "U" as const }]]), []).join("\n")).toContain("scan class is U");
    expect(problems(r2, scans, [])).toEqual([]);
  });

  it("every listed card that reads overlay materials or counters on a field has a MANIFEST entry", () => {
    const listed = new Set<number>();
    for (const scan of scans.values()) if (scan.rules.includes("field-count-compare") && !COMPARE_FALSE_POSITIVES.includes(scan.code)) listed.add(scan.code);
    const triage = readTriage();
    for (const entry of triage ?? []) if (entry.rule.startsWith("CHOOSER")) listed.add(entry.code);
    for (const card of manifest.cards) listed.add(card.code);
    expect(overlayReadersWithoutEntry(listed, manifest, stockText)).toEqual([]);
  });

  it("the overlay check fails for a listed card that reads overlay materials or counters and has no entry", () => {
    // Vola-Chemicritter Methydraco reads GetOverlayGroup on a field. Without its entry the check must name it.
    const readers = manifest.cards.filter((card) => OVERLAY_OR_COUNTER.test(stockText(card.code))).map((card) => card.code);
    expect(readers.length).toBeGreaterThan(0);
    for (const code of readers) {
      const without = JSON.parse(JSON.stringify(manifest)) as Manifest;
      without.cards = without.cards.filter((card) => card.code !== code);
      expect(overlayReadersWithoutEntry([code], without, stockText)).toEqual([code]);
      expect(overlayReadersWithoutEntry([code], manifest, stockText)).toEqual([]);
    }
    // A card with no such read is never named.
    expect(overlayReadersWithoutEntry([93507434], { version: 1, cards: [] }, stockText)).toEqual([]);
  });

  it("the table lists every compare and chooser card once, and no card twice", () => {
    const codes = TABLE.map((row) => row.code);
    expect(new Set(codes).size).toBe(codes.length);
    const compare = manifest.cards.filter((card) => card.classes.includes("COMPARE")).length;
    const chooser = manifest.cards.filter((card) => card.classes.includes("CHOOSER") && !COMPARE_EXTRA.includes(card.code)).length;
    expect(TABLE.filter((row) => row.group === "compare")).toHaveLength(compare);
    expect(TABLE.filter((row) => row.group === "chooser")).toHaveLength(chooser);
    // R1: an entry or a card of R1_NO_CHANGE, 92 in all. Fix entries: every entry of kind "fix" except Mirror Gate.
    expect(TABLE.filter((row) => row.group === "r1")).toHaveLength(manifest.cards.filter((card) => card.classes.includes("R1")).length + R1_NO_CHANGE.length);
    expect(TABLE.filter((row) => row.group === "r1")).toHaveLength(EXPECTED_COUNTS.r1);
    const r2Entries = manifest.cards.filter((card) => card.classes.includes("R2" as CardClass)).length;
    expect(TABLE.filter((row) => row.group === "r2")).toHaveLength(r2Entries + R2_NO_CHANGE.filter((code) => !manifest.cards.some((card) => card.code === code)).length);
    expect(TABLE.filter((row) => row.group === "fix")).toHaveLength(manifest.cards.filter((card) => card.kind === "fix" && card.classes.length === 0 && card.code !== MIRROR_GATE).length);
    expect(codes).not.toContain(MIRROR_GATE);
    for (const [code, reason] of Object.entries(NO_CONDITION_RUN)) expect(reason, code).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The live table.
// ---------------------------------------------------------------------------------------------------------------------------------

interface CardRow {
  code: number;
  type: number;
}

const TYPE = { monster: 0x1, spell: 0x2, trap: 0x4, field: 0x80000, extra: 0x40 | 0x2000 | 0x800000 | 0x4000000 };

let cardRows: Map<number, CardRow> | null = null;
function cardRow(code: number): CardRow {
  const row = cardRowsOf().get(code);
  if (!row) throw new Error(`card ${code} is not in cards.cdb`);
  return row;
}

function inCardDatabase(code: number): boolean {
  return cardRowsOf().has(code);
}

function cardRowsOf(): Map<number, CardRow> {
  if (!cardRows) {
    const db = new Database(join(engineDataDirectory, "cards.cdb"), { readonly: true });
    try {
      cardRows = new Map((db.prepare("SELECT id AS code, type FROM datas").all() as CardRow[]).map((row) => [row.code, row]));
    } finally {
      db.close();
    }
  }
  return cardRows;
}

type Layout = "behind" | "ahead";

const FILLERS = ["Giant Rat", "Battle Ox", "Celtic Guardian", "Axe Raider", "Silver Fang"];
const filler = (count: number): CardEntry[] => FILLERS.slice(0, count);

/**
 * The same card, in every place it can act from, for p0: hand, field (a monster, a set Spell or Trap, or the Field Spell Zone),
 * Graveyard, banished, Extra Deck. `behind`: every opponent has more cards than p0, so a "more than you" compare passes.
 * `ahead`: p0 has more cards, so a "fewer than you" compare passes. Each opponent has a different count, so the compare differs by seat.
 */
export function boardFor(format: DuelFormat, code: number, layout: Layout): BoardSpec {
  const { type } = cardRow(code);
  const extra = (type & TYPE.extra) !== 0;
  const monster = (type & TYPE.monster) !== 0;
  const p0: DuelistSetup = { hand: extra ? [...filler(2)] : [code, ...filler(2)], grave: [code], banished: [code] };
  if (extra) p0.extra = [code];
  const own: Array<CardEntry | null> = [];
  if (monster) own.push(code);
  if (!monster && (type & TYPE.field) !== 0) p0.field = code;
  else if (!monster) p0.spells = [{ card: code, pos: "set" }];
  own.push(...filler(layout === "ahead" ? 4 - own.length : 1));
  p0.monsters = own;
  if (layout === "ahead") p0.hand = [...(p0.hand ?? []), "Silver Fang"];
  const board: BoardSpec = { format, deckSize: 20, p0 };
  // `ahead`: one seat has an empty field and a Cyber Dragon in the hand (it Special Summons itself), so a card that waits for a Special Summon sees one.
  // In Tag that seat is p3, an opponent: the partner of p0 (p2) may Tribute the monsters of p0 (R-TAG-PARTNER-COST), and a Cyber Dragon there
  // would be Tribute Summoned with the card under test.
  const dragonSeat = format === "tag" ? 2 : 1;
  const counts = layout === "behind" ? [3, 2, 4] : format === "tag" ? [1, 1, 0] : [1, 0, 1];
  const hands: CardEntry[][] = layout === "behind" ? [filler(3), filler(2), filler(1)] : [0, 1, 2].map((index): CardEntry[] => (index === dragonSeat ? ["Cyber Dragon"] : []));
  (["p1", "p2", "p3"] as const).slice(0, seatCountFor(format) - 1).forEach((id, index) => {
    board[id] = {
      monsters: filler(counts[index]!),
      hand: hands[index],
      spells: layout === "behind" ? [{ card: "Dark Hole", pos: "set" }] : [],
    };
  });
  return board;
}

function multiBinary(): ArrayBuffer {
  const bytes = readFileSync(TRAP_WASM);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Wraps the setters of conditions and targets before any card loads: the first call of each card writes one line to stderr. */
const PROBE_SCRIPT = `
local seen={}
local function wrap(name,tag)
	local original=Effect[name]
	Effect[name]=function(e,f,...)
		if type(f)=="function" then
			local owner=e:GetOwner()
			local code=owner and owner:GetOriginalCode() or 0
			local inner=f
			f=function(...)
				local key=tag..code
				if not seen[key] then
					seen[key]=true
					io.stderr:write("TABLEPROBE "..tag.." "..code.."\\n")
				end
				return inner(...)
			end
		end
		return original(e,f,...)
	end
end
wrap("SetCondition","cond")
wrap("SetTarget","tgt")
wrap("SetCost","cost")
`;

export interface RunResult {
  /** A Lua error (an exception of the engine that is not a refused answer), first one only. */
  luaError: string | null;
  /** Trap lines of the core: `NFOLD <kind> ...` and `YGO_N_TRAP ...`. */
  traps: string[];
  /** Probe lines: `cond`, `tgt` or `cost`, for the card under test. */
  probes: Set<string>;
  /** Number of answers given. */
  steps: number;
  /** The highest turn reached. */
  turn: number;
  /** True when the run stopped on a prompt that no candidate answer could settle. */
  stuck: boolean;
}

const MAX_STEPS = 140;
const MAX_ACTIONS = 10;
const LIVELY_STEPS = 45;
const PASS_ORDER = ["to_ep", "to_m2", "to_bp"];
const LIVELY_ORDER = ["attack:", "summon:", "spsummon:", "mset:", "sset:", "activate:", "to_bp"];

/** New stderr lines of the diagnostics ring since the last poll. The ring keeps 200 entries, so the overlap of two polls is matched. */
function drain(game: EngineGame, previous: string[]): { fresh: string[]; all: string[] } {
  const all = game.diagnostics().filter((entry) => entry.kind === "stderr").map((entry) => `${entry.turn}|${entry.detail}`);
  let overlap = Math.min(previous.length, all.length);
  while (overlap > 0 && previous.slice(previous.length - overlap).join("\n") !== all.slice(0, overlap).join("\n")) overlap--;
  return { fresh: all.slice(overlap).map((line) => line.slice(line.indexOf("|") + 1)), all };
}

/** Plays one table game: p0 activates and summons (up to MAX_ACTIONS actions), every other seat passes; the rest by the fuzz answer planner. */
export async function playTable(format: DuelFormat, code: number, layout: Layout): Promise<RunResult> {
  const compiled = compileBoard(boardFor(format, code, layout));
  const options = { ...compiled.options, startupScripts: [{ name: "table-probe.lua", content: PROBE_SCRIPT }, ...(compiled.options.startupScripts ?? [])] };
  const result: RunResult = { luaError: null, traps: [], probes: new Set(), steps: 0, turn: 0, stuck: false };
  let game: EngineGame | null = null;
  let ring: string[] = [];
  const collect = () => {
    if (!game) return;
    const { fresh, all } = drain(game, ring);
    ring = all;
    for (const line of fresh) {
      const probe = /^TABLEPROBE (\w+) (\d+)/.exec(line);
      if (probe) {
        if (Number(probe[2]) === code) result.probes.add(probe[1]!);
      } else if (process.env.TABLE_TRACE && line.startsWith("DBG ")) {
        appendFileSync(process.env.TABLE_TRACE, `${line.trim()}\n`);
      } else if (/NFOLD |YGO_N_TRAP/.test(line)) {
        result.traps.push(line.trim());
      }
    }
  };
  try {
    game = await createEngineGame({
      ...options,
      seed: ["1", "2", "3", "4"],
      dataDirectory: engineDataDirectory,
      multiWasmBinary: multiBinary(),
      multiScriptsDirectory: overlayDirectory,
    });
    collect();
    const rng = new Rng(code);
    let actions = 0;
    while (result.steps < MAX_STEPS) {
      const seats = Array.from({ length: seatCountFor(format) }, (_, seat) => seat);
      const open = seats.map((seat) => ({ seat, view: game!.view(seat) })).find((entry) => entry.view.prompt);
      if (!open) break;
      const { seat, view } = open;
      const prompt = view.prompt as DuelPrompt;
      result.turn = Math.max(result.turn, view.turn);
      if (view.result) break;
      const answers = candidatesFor(prompt, seat, actions < MAX_ACTIONS, result.steps < LIVELY_STEPS, rng, game, view.seats?.filter((entry) => !entry.eliminated).map((entry) => entry.seat));
      let accepted: DuelAnswer | null = null;
      for (const answer of answers) {
        try {
          game.answer(seat, prompt.id, answer);
          accepted = answer;
          break;
        } catch (error) {
          if (error instanceof EngineAnswerError) continue;
          result.luaError = error instanceof Error ? error.message : String(error);
          collect();
          return result;
        }
      }
      collect();
      if (!accepted) {
        result.stuck = true;
        break;
      }
      result.steps++;
      if (process.env.TABLE_TRACE) {
        appendFileSync(process.env.TABLE_TRACE, `${code} ${layout} #${result.steps} t${view.turn} p${seat} ${prompt.kind}/${prompt.context?.type ?? "-"} "${prompt.title}" [${prompt.options.map((option) => option.id).join(",")}] -> ${JSON.stringify(accepted)}\n`);
      }
      if (seat === 0 && prompt.context?.type === "action" && "choice" in accepted && !PASS_ORDER.includes(String(accepted.choice))) actions++;
    }
  } catch (error) {
    result.luaError = error instanceof Error ? error.message : String(error);
    collect();
  } finally {
    game?.close();
  }
  return result;
}

function candidatesFor(prompt: DuelPrompt, seat: number, active: boolean, lively: boolean, rng: Rng, game: EngineGame, living: number[] | undefined): DuelAnswer[] {
  if (prompt.kind === "choice" && prompt.context?.type === "action") {
    const ids = prompt.options.map((option) => option.id);
    if (seat === 0 && active) {
      const acts = ids.filter((id) => id.startsWith("activate:") || id.startsWith("spsummon:") || id.startsWith("summon:") || id.startsWith("sset:"));
      if (acts.length > 0) return [...acts.map((id) => ({ choice: id })), ...PASS_ORDER.filter((id) => ids.includes(id)).map((id) => ({ choice: id }))];
    }
    const pass = PASS_ORDER.filter((id) => ids.includes(id));
    if (seat !== 0 && lively) {
      // Early turns: the other seats attack, summon, set and activate in this order, so that trigger cards see events.
      const wanted = LIVELY_ORDER.flatMap((prefix) => ids.filter((id) => id.startsWith(prefix)));
      return [...wanted.map((id) => ({ choice: id })), ...pass.map((id) => ({ choice: id })), ...ids.map((id) => ({ choice: id }))];
    }
    return [...pass.map((id) => ({ choice: id })), ...ids.map((id) => ({ choice: id }))];
  }
  if (prompt.kind === "choice" && prompt.context?.type === "chain" && prompt.cancelable && seat !== 0) return [{ cancel: true }];
  const plan = planAnswer(prompt, { rng, turnActions: 0, toggleSteps: 0, searchCards: (query) => game.searchCards(query), living });
  const out = [...plan.candidates];
  if (prompt.cancelable) out.push({ cancel: true });
  return out;
}

/** The trap lines of a result that fail the card. */
export function unexpectedTraps(code: number, traps: readonly string[]): string[] {
  const allowed = EXPECTED_TRAPS[code] ?? [];
  return traps.filter((line) => {
    const kind = /^NFOLD (\w+)/.exec(line)?.[1];
    if (kind && allowed.some((entry) => entry.kind === kind)) return false;
    if (kind) return TRAP_FAIL_KINDS.includes(kind);
    return /YGO_N_TRAP/.test(line);
  });
}

describeWithCores("the table: every listed card on the debug core", [liveNseat, trapWasm, stock], () => {
  it("the probe wrapper sees the condition of a known card at three seats", async () => {
    const run = await playTable("ffa3", 93507434, "behind");
    expect(run.luaError).toBeNull();
    expect(run.probes.has("cond")).toBe(true);
  }, 60_000);

  for (const format of FORMATS) {
    for (const row of TABLE) {
      it(`${row.group} ${row.code} ${row.name} at ${format}: loads, runs its condition, no trap U or c`, async () => {
        if (NOT_IN_CARD_DATABASE[row.code]) {
          expect(inCardDatabase(row.code), `${NOT_IN_CARD_DATABASE[row.code]} (remove the entry when the card is in the database)`).toBe(false);
          return;
        }
        const runs = [await playTable(format, row.code, "behind"), await playTable(format, row.code, "ahead")];
        if (process.env.TABLE_DEBUG) appendFileSync(process.env.TABLE_DEBUG, `TABLE ${format} ${row.code} ${row.name}: ${runs.map((run) => `steps=${run.steps} turn=${run.turn} stuck=${run.stuck} probes=${[...run.probes].join("/")} traps=${run.traps.length}[${[...new Set(run.traps.map((line) => /^NFOLD (\w)/.exec(line)?.[1] ?? "?"))].join("")}] err=${run.luaError ?? "-"}`).join(" | ")}\n`);
        const gap = gapFor(row.code, format);
        if (gap) {
          expect(runs.some((run) => showsGap(gap, run)), `known gap (${gap.reason}) no longer shows: remove the KNOWN_GAPS entry`).toBe(true);
          return;
        }
        for (const run of runs) {
          expect(run.luaError, "Lua error").toBeNull();
          expect(unexpectedTraps(row.code, run.traps), "trap lines").toEqual([]);
        }
        const ran = runs.some((run) => run.probes.has("cond") || run.probes.has("tgt") || run.probes.has("cost"));
        if (NO_CONDITION_RUN[row.code] && (NO_CONDITION_RUN_ONLY[row.code] ?? FORMATS).includes(format)) expect(ran, `${NO_CONDITION_RUN[row.code]} (remove the entry when it runs)`).toBe(false);
        else expect(ran, "the condition, target or cost never ran").toBe(true);
      }, 120_000);
    }
  }
});

describe("the table helpers", () => {
  it("keeps a reason on every known gap and every card without a condition run, and lists only cards of the table", () => {
    const listed = new Set(TABLE.map((row) => row.code));
    for (const [code, gaps] of Object.entries(KNOWN_GAPS)) {
      expect(listed.has(Number(code)), `${code} is in the table`).toBe(true);
      for (const gap of gaps) {
        expect(gap.reason, code).toBeTruthy();
        expect(Boolean(gap.luaError) !== Boolean(gap.trap), `${code} names one symptom`).toBe(true);
      }
    }
    for (const code of Object.keys(NO_CONDITION_RUN)) expect(listed.has(Number(code)), `${code} is in the table`).toBe(true);
    for (const [code, reason] of Object.entries(NOT_IN_CARD_DATABASE)) {
      expect(listed.has(Number(code)), `${code} is in the table`).toBe(true);
      expect(reason, code).toBeTruthy();
    }
    for (const code of Object.keys(NO_CONDITION_RUN_ONLY)) expect(NO_CONDITION_RUN[Number(code)], `${code} has a NO_CONDITION_RUN entry`).toBeTruthy();
  });

  it("matches a known gap by its Lua error or by its trap kind, and by nothing else", () => {
    const lua: KnownGap = { format: "ffa3", luaError: /nil value/, reason: "x" };
    const trap: KnownGap = { format: "tag", trap: "c", reason: "x" };
    expect(showsGap(lua, { luaError: "c1.lua:3: attempt to index a nil value", traps: [] })).toBe(true);
    expect(showsGap(lua, { luaError: null, traps: ["NFOLD c card=1 P=0 fn=x"] })).toBe(false);
    expect(showsGap(trap, { luaError: null, traps: ["NFOLD c card=1 P=0 fn=x"] })).toBe(true);
    expect(showsGap(trap, { luaError: null, traps: ["NFOLD a card=1 P=0 fn=x"] })).toBe(false);
  });

  it("lists the groups compare, chooser, R1, R2 and fix of a manifest in this order, once per card, without Mirror Gate", () => {
    const rows = tableCardsOf(manifest);
    expect(rows.find((row) => row.code === MIRROR_GATE)).toBeUndefined();
    const order = ["compare", "chooser", "r1", "r2", "fix"];
    expect(rows.map((row) => order.indexOf(row.group))).toEqual(rows.map((row) => order.indexOf(row.group)).sort((a, b) => a - b));
    expect(noChangeCards("r1", [1, 2, 3], new Set([2])).map((row) => `${row.group}:${row.code}`)).toEqual(["r1:1", "r1:3"]);
    expect(rows.filter((row) => row.code === 15693423)).toHaveLength(1);
    expect(rows.find((row) => row.code === 15693423)?.group).toBe("compare");
  });

  it("fails the trap kinds U, c and W and a core trap line, and lets the other kinds and an expected kind pass", () => {
    expect(unexpectedTraps(1, ["NFOLD U card=1 P=3 fn=x"])).toHaveLength(1);
    expect(unexpectedTraps(1, ["NFOLD c card=1 P=3 fn=x"])).toHaveLength(1);
    expect(unexpectedTraps(1, ["NFOLD W card=1 P=3 fn=x"])).toHaveLength(1);
    expect(unexpectedTraps(1, ["YGO_N_TRAP window map leak"])).toHaveLength(1);
    expect(unexpectedTraps(1, ["NFOLD a card=1 P=3 fn=x"])).toEqual([]);
    expect(unexpectedTraps(1, [])).toEqual([]);
  });

  it("matches the stderr ring across two polls", () => {
    const game = { diagnostics: () => [{ turn: 1, phase: "main1", kind: "stderr", seat: null, detail: "b" }, { turn: 1, phase: "main1", kind: "stderr", seat: null, detail: "c" }] } as unknown as EngineGame;
    expect(drain(game, ["1|a", "1|b"]).fresh).toEqual(["c"]);
    expect(drain(game, []).fresh).toEqual(["b", "c"]);
  });
});
