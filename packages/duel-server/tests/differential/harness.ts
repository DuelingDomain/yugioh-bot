import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngineGame } from "../../src/engine.js";
import { scenarioFor } from "../fuzz/config.js";
import { readViews, runDuel, setupScenario, type DuelOutcome } from "../fuzz/driver.js";
import { viewsHash } from "../fuzz/invariants.js";
import { Rng } from "../fuzz/rng.js";
import { needs, type CoreNeed } from "../support/cores.js";
import { setWasmOverride, sha1, startRecording, stopRecording, type Trace } from "./trace.js";

export const MULTI_WASM_PATH = resolve(
  process.env.DIFF_MULTI_WASM ?? fileURLToPath(new URL("../../domain-core/dist/ocgcore.multi.sync.wasm", import.meta.url)),
);

/**
 * Reference core for the comparison: the patches 1 and 2 build with a fixed Lua seed
 * (scripts/build-multi-core.sh, see domain-core/patches/README.md). Lua seeds its hash and
 * math.random from addresses, so two different binaries only match when the seed is fixed.
 */
export const REFERENCE_WASM_PATH = resolve(
  process.env.DIFF_REFERENCE_WASM ?? fileURLToPath(new URL("../../domain-core/dist/ocgcore.multi-ref.sync.wasm", import.meta.url)),
);

export function readWasm(path: string): ArrayBuffer {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function standardWasmPath(dataDirectory: string): string {
  return join(dataDirectory, "ocgcore.standard.wasm");
}

/** What every differential test needs: the standard core and the card database of the engine data directory. */
export function dataNeeds(dataDirectory: string): CoreNeed[] {
  return [needs.standard(dataDirectory), needs.cards(dataDirectory)];
}

export interface Diff {
  seed: number;
  /** Zero based index of the core process step, or -1 when the failure is not tied to a step. */
  step: number;
  kind: "messages" | "raw" | "field" | "status" | "step-count" | "views" | "replay-error";
  message: string;
  expected: string;
  actual: string;
}

export interface SeedResult {
  seed: number;
  /** Journal length of the self-play duel (answers). */
  answers: number;
  /** Core process steps recorded. */
  processSteps: number;
  messages: number;
  /** The self-play duel broke a fuzz invariant or hit the step cap. The cores are still compared. */
  note: string;
  diff: Diff | null;
  /** "failed to parse a message" warnings of the wrapper during this replay, with the step. */
  parseWarnings: string[];
}

export function seedsFor(base: number, runs: number): number[] {
  const rng = new Rng(base);
  const seeds = new Set<number>();
  while (seeds.size < runs) seeds.add(1 + rng.int(2 ** 31 - 2));
  return [...seeds];
}

function clip(text: string, max = 1200): string {
  return text.length > max ? `${text.slice(0, max)}... (${text.length} chars)` : text;
}

/** First difference between two traces, or null. Checks step count, status, each parsed message, the raw bytes of each message, then the field. */
export function firstDiff(seed: number, expected: Trace, actual: Trace): Diff | null {
  const common = Math.min(expected.steps.length, actual.steps.length);
  for (let i = 0; i < common; i++) {
    const a = expected.steps[i]!;
    const b = actual.steps[i]!;
    if (a.status !== b.status) {
      return { seed, step: i, kind: "status", message: "process status differs", expected: String(a.status), actual: String(b.status) };
    }
    const count = Math.max(a.messages.length, b.messages.length);
    for (let m = 0; m < count; m++) {
      if (a.messages[m] !== b.messages[m]) {
        return {
          seed,
          step: i,
          kind: "messages",
          message: `message ${m} of ${count} differs`,
          expected: clip(a.messages[m] ?? "(none)"),
          actual: clip(b.messages[m] ?? "(none)"),
        };
      }
    }
    const rawCount = Math.max(a.raw.length, b.raw.length);
    for (let m = 0; m < rawCount; m++) {
      const x = a.raw[m];
      const y = b.raw[m];
      if (x !== y) {
        let at = 0;
        while (x !== undefined && y !== undefined && at < x.length && x[at] === y[at]) at++;
        return {
          seed,
          step: i,
          kind: "raw",
          message: `raw bytes of message ${m} of ${rawCount} differ at byte ${at >> 1} (type ${(x ?? y ?? "").slice(0, 2)} hex)`,
          expected: clip(x ?? "(none)"),
          actual: clip(y ?? "(none)"),
        };
      }
    }
    if (a.field !== b.field) {
      let at = 0;
      while (at < a.field.length && a.field[at] === b.field[at]) at++;
      return {
        seed,
        step: i,
        kind: "field",
        message: `field snapshot differs at character ${at}`,
        expected: clip(a.field.slice(Math.max(0, at - 200), at + 400)),
        actual: clip(b.field.slice(Math.max(0, at - 200), at + 400)),
      };
    }
  }
  if (expected.steps.length !== actual.steps.length) {
    return {
      seed,
      step: common,
      kind: "step-count",
      message: "process step counts differ",
      expected: String(expected.steps.length),
      actual: String(actual.steps.length),
    };
  }
  return null;
}

export interface Recorded {
  outcome: DuelOutcome;
  trace: Trace;
}

/** Self-play one seeded duel on the core in the data directory (stock), recording the trace. */
export async function recordStock(seed: number, dataDirectory: string, maxSteps: number, wasm: ArrayBuffer | null = null): Promise<Recorded> {
  const scenario = scenarioFor(seed, { mode: "normal", masterRule: null, maxSteps });
  const trace = startRecording();
  setWasmOverride(wasm);
  try {
    const outcome = await runDuel(scenario, dataDirectory);
    return { outcome, trace };
  } finally {
    setWasmOverride(null);
    stopRecording();
  }
}

/**
 * Replay the recorded journal on `wasm`, recording the trace. Same flow as tests/fuzz/replay.ts
 * (same options, same seed, check revision and prompt id, then answer), but the core comes from
 * `standardWasmBinary`. Returns the trace and the final views hash. Throws on engine errors.
 */
export async function replayOn(recorded: DuelOutcome, dataDirectory: string, wasm: ArrayBuffer): Promise<{ trace: Trace; finalHash: string }> {
  const setup = setupScenario(recorded.scenario, dataDirectory);
  const trace = startRecording();
  try {
    const game = await createEngineGame({
      mode: recorded.scenario.mode,
      masterRule: recorded.scenario.masterRule,
      decks: setup.decks,
      seed: setup.engineSeed,
      dataDirectory,
      standardWasmBinary: wasm,
    });
    try {
      for (let i = 0; i < recorded.journal.length; i++) {
        const command = recorded.journal[i]!;
        const view = game.view(command.seat);
        if (view.revision !== command.revision) throw new Error(`journal entry ${i}: revision ${view.revision}, journal ${command.revision}`);
        if (view.prompt?.id !== command.promptId) throw new Error(`journal entry ${i}: prompt ${view.prompt?.id ?? "none"}, journal ${command.promptId}`);
        game.answer(command.seat, command.promptId, command.answer);
      }
      return { trace, finalHash: viewsHash(readViews(game)) };
    } finally {
      game.close();
    }
  } finally {
    stopRecording();
  }
}

/** Record the journal on stock, replay it on stock (reference), then again on stock (self-check) and, when given, on the multi core. */
export async function compareSeed(
  seed: number,
  dataDirectory: string,
  maxSteps: number,
  cores: { stock: ArrayBuffer; multi: ArrayBuffer | null },
): Promise<{ stock: SeedResult; multi: SeedResult | null }> {
  const { outcome } = await recordStock(seed, dataDirectory, maxSteps, cores.stock);
  // The reference trace is a stock REPLAY, not the self-play run. Self-play makes extra view and
  // invariant calls that change the wasm heap layout, and the core has pointer ordered containers,
  // so its self-play trace can differ from a replay of the same journal. A replay makes the same
  // calls on every core, so the layout is the same.
  const reference = await replayOn(outcome, dataDirectory, cores.stock);
  const trace = reference.trace;
  const note = outcome.failure ? `self-play ended early: ${outcome.failure.invariant}` : outcome.ended ? "duel ended" : "step cap";
  const base = {
    seed,
    answers: outcome.journal.length,
    processSteps: trace.steps.length,
    messages: trace.steps.reduce((sum, step) => sum + step.raw.length, 0),
    note,
  };
  const warningsOf = (steps: Trace["steps"]) => steps.flatMap((step, index) => step.parseWarnings.map((text) => `step ${index}: ${text}`));
  const run = async (wasm: ArrayBuffer): Promise<SeedResult> => {
    try {
      const replay = await replayOn(outcome, dataDirectory, wasm);
      let diff = firstDiff(seed, trace, replay.trace);
      if (!diff && replay.finalHash !== reference.finalHash) {
        diff = { seed, step: -1, kind: "views", message: "final views hash differs", expected: reference.finalHash, actual: replay.finalHash };
      }
      return { ...base, diff, parseWarnings: warningsOf(replay.trace.steps) };
    } catch (error) {
      const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return {
        ...base,
        diff: { seed, step: -1, kind: "replay-error", message: "replay threw", expected: "no error", actual: clip(text) },
        parseWarnings: [],
      };
    }
  };
  const stock = await run(cores.stock);
  const multi = cores.multi ? await run(cores.multi) : null;
  return { stock, multi };
}

export function describeDiff(diff: Diff): string {
  return [
    `DIFF seed ${diff.seed}, process step ${diff.step}, ${diff.kind}: ${diff.message}`,
    `  stock:  ${diff.expected}`,
    `  other:  ${diff.actual}`,
  ].join("\n");
}

export { sha1 };
