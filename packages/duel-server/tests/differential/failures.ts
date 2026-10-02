import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DuelDeck, DuelFormat, DuelMasterRule, DuelMode, DuelSettings } from "@yugidraft/shared/duels";
import type { Scenario } from "../fuzz/config.js";
import type { JournalEntry } from "../fuzz/driver.js";
import { describeDiff, type Diff } from "./harness.js";
import { firstTurnDrawFor } from "../../src/first-turn-draw.js";

export const DIFFERENTIAL_FAILURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "failures");

/** Output folder: `DIFF_FAILURE_DIR` if set, else `tests/differential/failures`. */
export function differentialFailureDir(): string {
  const fromEnv = process.env.DIFF_FAILURE_DIR;
  return fromEnv ? resolve(fromEnv) : DIFFERENTIAL_FAILURE_DIR;
}

/** Name prefix of a failure file: `GATE_TAG` if set (a gate run), else `local`. */
export function differentialFailureTag(): string {
  return (process.env.GATE_TAG ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-") || "local";
}
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Everything `createEngineGame` needs to start the duel again (besides the data directory and the wasm). */
export interface EngineSpec {
  mode: DuelMode;
  masterRule?: DuelMasterRule;
  decks: DuelDeck[];
  seed: string[];
  settings?: DuelSettings;
  startupScripts?: Array<{ name: string; content: string }>;
  format?: DuelFormat;
  firstTurnDraw?: boolean;
}

/** A duel recorded on the reference core: how it started and every answer. */
export interface RecordedDuel {
  /** Fuzz style scenario header (seed, mode, master rule, step cap). */
  scenario: Scenario;
  engine: EngineSpec;
  journal: JournalEntry[];
  deckNotes: [string, string];
  disjoint: boolean;
  /** Only for the scenarios mode. */
  scenarioId?: string;
  /** How the self-play ended: "duel ended", "step cap" or "self-play ended early: ...". */
  note: string;
}

export interface DifferentialFailureInput {
  /** "long", "domain" or "scenarios". */
  mode: string;
  seed: number;
  recorded: RecordedDuel;
  diff: Diff;
  /** Which comparison found it: the second run on the reference core (harness check) or the multi core. */
  found: "reference-self-check" | "multi";
  referenceWasm: string;
  multiWasm: string;
  dataDirectory: string;
}

export function differentialFailureName(mode: string, seed: number, tag = differentialFailureTag()): string {
  return `${tag}-${mode}-${seed}.json`;
}

/** The command that replays a failure file. Add --wasm <path> to choose the core. */
export function differentialReproCommand(file: string, wasm: string, dataDirectory: string): string {
  // Relative to the package when inside it, else absolute (DIFF_FAILURE_DIR may be anywhere).
  const data = relative(PACKAGE_DIR, dataDirectory);
  const rel = relative(PACKAGE_DIR, file);
  const dataArg = data && !data.startsWith("..") ? `$PWD/${data}` : resolve(dataDirectory);
  const fileArg = rel && !rel.startsWith("..") ? rel : resolve(file);
  return `cd packages/duel-server && DUEL_DATA_DIR=${dataArg} npx tsx scripts/fuzz-repro.ts --file ${fileArg} --wasm ${wasm}`;
}

/**
 * Write one differing duel in the fuzz failure format (tests/fuzz/failures.ts) plus the `engine`
 * and `differential` blocks. `scripts/fuzz-repro.ts --file <it> --wasm <core>` replays the journal.
 */
export function writeDifferentialFailure(input: DifferentialFailureInput, directory = differentialFailureDir()): string {
  mkdirSync(directory, { recursive: true });
  const { recorded, diff } = input;
  const path = join(directory, differentialFailureName(input.mode, input.seed));
  const firstDifference = describeDiff(diff);
  writeFileSync(
    path,
    JSON.stringify(
      {
        scenario: recorded.scenario,
        failure: { invariant: `differential-${diff.kind}`, message: diff.message, step: diff.step },
        knownIssue: null,
        repro: differentialReproCommand(path, input.multiWasm, input.dataDirectory),
        decks: recorded.engine.decks,
        deckNotes: recorded.deckNotes,
        disjointDecks: recorded.disjoint,
        steps: recorded.journal.length,
        journal: recorded.journal,
        engine: { ...recorded.engine, firstTurnDraw: recorded.engine.firstTurnDraw ?? firstTurnDrawFor(recorded.engine.mode, recorded.engine.masterRule) },
        differential: {
          mode: input.mode,
          seed: input.seed,
          ...(recorded.scenarioId ? { scenarioId: recorded.scenarioId } : {}),
          found: input.found,
          firstDifference,
          diff,
          referenceWasm: input.referenceWasm,
          multiWasm: input.multiWasm,
          dataDirectory: input.dataDirectory,
          selfPlay: recorded.note,
        },
      },
      null,
      1,
    ),
  );
  return path;
}
