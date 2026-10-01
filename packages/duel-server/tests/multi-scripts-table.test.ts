import Database from "better-sqlite3";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DuelAnswer, DuelFormat, DuelPrompt } from "@yugidraft/shared/duels";
import { seatCountFor } from "@yugidraft/shared/duels";
import {
  COMPARE_EXTRA, COMPARE_FALSE_POSITIVES, MIRROR_GATE, OVERLAY_DIRECTORY, readManifest, readTriage, type CardClass, type Manifest,
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
// Without it the live table is skipped (a local file).

const TRAP_WASM = process.env.TABLE_TRAP_WASM
  ? resolve(process.env.TABLE_TRAP_WASM)
  : fileURLToPath(new URL(`../domain-core/dist/ocgcore.multi-${CURRENT_MULTI_TAG}-trap.sync.wasm`, import.meta.url));
const trapWasm = needs.localFile("debug multi core (-DYGO_N_TRAP)", TRAP_WASM, "Build it with EXTRA_CXXFLAGS=-DYGO_N_TRAP (see the head of tests/multi-scripts-table.test.ts) or set TABLE_TRAP_WASM.");

const manifest = readManifest();
const stockDirectory = process.env.DUEL_SCRIPTS_DIR ?? join(currentEngineDataDirectory(), "card-scripts/official");
const stock = needs.file("official script corpus", stockDirectory, "Set DUEL_SCRIPTS_DIR, or set DUEL_DATA_DIR to an engine data directory with card-scripts/official.");
const stockText = (code: number) => readFileSync(join(stockDirectory, `c${code}.lua`), "utf8");

// ---------------------------------------------------------------------------------------------------------------------------------
// The table. A group is a list of codes. R1 (each duelist) and R2 groups are added here by the parts that write their overlay.
// ---------------------------------------------------------------------------------------------------------------------------------

export type TableGroup = "compare" | "chooser" | "r1" | "r2";

export interface TableCard {
  code: number;
  group: TableGroup;
  name: string;
}

/** Cards of a manifest by class. A card of both classes (Evenly Matched, Pineapple Blast) is listed once, in the compare group. */
export function tableCardsOf(source: Manifest): TableCard[] {
  const rows: TableCard[] = [];
  for (const card of source.cards) {
    if (card.kind === "fix") continue;
    if (card.classes.includes("COMPARE")) rows.push({ code: card.code, group: "compare", name: card.name });
    else if (card.classes.includes("CHOOSER")) rows.push({ code: card.code, group: "chooser", name: card.name });
  }
  return rows;
}

/** Later parts append here: { code, group: "r1" | "r2", name }. Each needs a MANIFEST entry only when it has an overlay file. */
const APPENDED_CARDS: TableCard[] = [];

const TABLE: TableCard[] = [...tableCardsOf(manifest), ...APPENDED_CARDS];

/**
 * Trap lines that a card causes on purpose, by code: the line kind. Empty today. Each entry needs a reason.
 */
const EXPECTED_TRAPS: Record<number, { kind: string; reason: string }[]> = {};

/** Cards whose condition cannot run in this generic game, by code, with the reason. Empty entries are not allowed. */
const NO_CONDITION_RUN: Record<number, string> = {
  1804528: "Dark Coffin: the trigger needs this card to be face-down on the field and destroyed; no generic seat destroys a set Trap",
  12247206: "Inferno Reckless Summon: the condition needs p0 to Special Summon exactly one weak monster while an opponent has a monster; the generic driver does not play it",
  36898537: "Metaphys Horus: the triggers need a Synchro Summon of this card; the generic game has no Synchro materials",
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

/** Problems with the classes of the manifest against the scan of the stock scripts. */
export function classProblems(source: Manifest, scans: Map<number, CardScan>, falsePositives: readonly number[] = COMPARE_FALSE_POSITIVES): string[] {
  const problems: string[] = [];
  for (const card of source.cards) {
    if (card.kind === "fix") continue;
    const scan = scans.get(card.code);
    if (!scan) {
      problems.push(`${card.code} ${card.name}: not in the scan`);
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
    expect(classProblems(manifest, scans)).toEqual([]);
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
  if (!cardRows) {
    const db = new Database(join(engineDataDirectory, "cards.cdb"), { readonly: true });
    try {
      cardRows = new Map((db.prepare("SELECT id AS code, type FROM datas").all() as CardRow[]).map((row) => [row.code, row]));
    } finally {
      db.close();
    }
  }
  const row = cardRows.get(code);
  if (!row) throw new Error(`card ${code} is not in cards.cdb`);
  return row;
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
  const counts = layout === "behind" ? [3, 2, 4] : [1, 0, 1];
  // `ahead`: p2 has an empty field and a Cyber Dragon in the hand (it Special Summons itself), so a card that waits for a Special Summon sees one.
  const hands: CardEntry[][] = layout === "behind" ? [filler(3), filler(2), filler(1)] : [[], ["Cyber Dragon"], []];
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
      multiScriptsDirectory: process.env.TABLE_OVERLAY ? resolve(process.env.TABLE_OVERLAY) : OVERLAY_DIRECTORY,
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
        if (NO_CONDITION_RUN[row.code]) expect(ran, `${NO_CONDITION_RUN[row.code]} (remove the entry when it runs)`).toBe(false);
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
  });

  it("matches a known gap by its Lua error or by its trap kind, and by nothing else", () => {
    const lua: KnownGap = { format: "ffa3", luaError: /nil value/, reason: "x" };
    const trap: KnownGap = { format: "tag", trap: "c", reason: "x" };
    expect(showsGap(lua, { luaError: "c1.lua:3: attempt to index a nil value", traps: [] })).toBe(true);
    expect(showsGap(lua, { luaError: null, traps: ["NFOLD c card=1 P=0 fn=x"] })).toBe(false);
    expect(showsGap(trap, { luaError: null, traps: ["NFOLD c card=1 P=0 fn=x"] })).toBe(true);
    expect(showsGap(trap, { luaError: null, traps: ["NFOLD a card=1 P=0 fn=x"] })).toBe(false);
  });

  it("lists the compare group before the chooser group of a manifest, once per card, without the fix", () => {
    const rows = tableCardsOf(manifest);
    expect(rows.find((row) => row.code === MIRROR_GATE)).toBeUndefined();
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
