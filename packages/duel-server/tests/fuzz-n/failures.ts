import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DuelDeck } from "@yugidraft/shared/duels";
import type { CoreInfo } from "./core.js";
import type { JournalItem, NFailure, NOutcome, NScenario } from "./driver.js";
import { knownIssueFor } from "./known-issues.js";
import { engineSeed } from "../fuzz/rng.js";
import { savedFuzzFirstTurnDraw } from "../../scripts/lib/fuzz-draw-rule.js";
import type { EngineGameOptions } from "../../src/engine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const N_FAILURE_DIR = resolve(HERE, "failures");
const PACKAGE_DIR = resolve(HERE, "../..");

/** One failing duel, enough to replay it: `npm run fuzz:n -- --repro <file>`. */
export interface FailureFile {
  format: string;
  seed: number;
  scenario: NScenario;
  engine?: Partial<Pick<EngineGameOptions, "mode" | "masterRule" | "format" | "decks" | "seed">> & { firstTurnDraw: boolean };
  wasm: { tag: string; sha256: string; path: string };
  /** Decks are rebuilt from `seed` (deck RNG fork 1, engine seed from the same seed); they are stored as well. */
  deckSeed: number;
  decks: DuelDeck[];
  deckNotes: string[];
  /** Every accepted answer and host elimination, in order. */
  answers: JournalItem[];
  /** The action in progress when the failure happened (a hang or a throw): replay tries it last. */
  pending: JournalItem | null;
  check: { name: string; message: string; step: number };
  lastPrompt: { seat: number | null; prompt: unknown } | null;
  knownIssue: { sig: string; owner: string } | null;
  diagnostics: unknown[];
  repro: string;
}

export function failureFileName(format: string, seed: number, coreTag: string): string {
  return `${format}-${seed}-${coreTag.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
}

export function reproCommand(file: string): string {
  return `cd packages/duel-server && npm run fuzz:n -- --repro ${relative(PACKAGE_DIR, resolve(file))}`;
}

export function buildFailureFile(outcome: NOutcome, core: CoreInfo, failure: NFailure): FailureFile {
  const known = knownIssueFor(failure, { format: outcome.scenario.format, coreTag: core.tag });
  const path = join(N_FAILURE_DIR, failureFileName(outcome.scenario.format, outcome.scenario.seed, core.tag));
  return {
    format: outcome.scenario.format,
    seed: outcome.scenario.seed,
    scenario: outcome.scenario,
    engine: { mode: outcome.scenario.mode, masterRule: outcome.scenario.masterRule, format: outcome.scenario.format,
      decks: outcome.decks, seed: engineSeed(outcome.scenario.seed), firstTurnDraw: outcome.firstTurnDraw },
    wasm: { tag: core.tag, sha256: core.sha256, path: core.path },
    deckSeed: outcome.scenario.seed,
    decks: outcome.decks,
    deckNotes: outcome.deckNotes,
    answers: outcome.journal,
    pending: failure.pending ?? null,
    check: { name: failure.invariant, message: failure.message, step: failure.step },
    lastPrompt: failure.prompt ? { seat: failure.seat ?? failure.prompt.seat ?? null, prompt: failure.prompt } : null,
    knownIssue: known ? { sig: known.sig, owner: known.owner } : null,
    diagnostics: outcome.diagnostics,
    repro: reproCommand(path),
  };
}

export function writeFailureFile(file: FailureFile, directory = N_FAILURE_DIR): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, failureFileName(file.format, file.seed, file.wasm.tag));
  writeFileSync(path, JSON.stringify(file, null, 1));
  return path;
}

export function readFailureFile(path: string): FailureFile {
  const file = JSON.parse(readFileSync(path, "utf8")) as FailureFile;
  file.engine = { ...file.engine, firstTurnDraw: savedFuzzFirstTurnDraw(file.engine?.firstTurnDraw, file.scenario.mode, file.scenario.masterRule) };
  return file;
}

export function describeFailure(file: Pick<FailureFile, "format" | "seed" | "wasm" | "check" | "lastPrompt" | "knownIssue" | "repro">): string {
  const lines = [
    `FUZZ-N FAILURE [${file.check.name}]${file.knownIssue ? ` (known: ${file.knownIssue.sig}, owner ${file.knownIssue.owner})` : " (NEW)"}`,
    `  ${file.format} seed ${file.seed} core ${file.wasm.tag} step ${file.check.step}`,
    `  ${file.check.message}`,
  ];
  const prompt = file.lastPrompt?.prompt as { kind?: string; title?: string; options?: Array<{ label: string }> } | undefined;
  if (prompt) {
    lines.push(`  last prompt seat ${file.lastPrompt?.seat ?? "?"} [${prompt.kind}] "${prompt.title}" options: ${(prompt.options ?? []).slice(0, 6).map((o) => o.label).join(" | ")}`);
  }
  lines.push(`  repro: ${file.repro}`);
  return lines.join("\n");
}
