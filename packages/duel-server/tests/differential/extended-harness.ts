import type { DuelAnswer, DuelMode } from "@yugidraft/shared/duels";
import { EngineAnswerError, createEngineGame } from "../../src/engine.js";
import { planAnswer } from "../fuzz/answers.js";
import { scenarioFor } from "../fuzz/config.js";
import { readViews, runDuel, setupScenario, type JournalEntry } from "../fuzz/driver.js";
import { viewsHash } from "../fuzz/invariants.js";
import { Rng } from "../fuzz/rng.js";
import type { CompiledBoard } from "../support/board.js";
import type { EngineSpec, RecordedDuel } from "./failures.js";
import { firstDiff, type Diff, type SeedResult } from "./harness.js";
import { setWasmOverride, startRecording, stopRecording, type Trace } from "./trace.js";
import { firstTurnDrawFor } from "../../src/first-turn-draw.js";

/**
 * Generalised differential flow for the extended test: any duel mode (Standard or Domain) and any
 * start (seeded decks or a Layer 1 board). Needs the `vi.mock("ocgcore-wasm")` recorder of the test
 * file. Every core the engine creates, Domain included, gets its wasm from `setWasmOverride`.
 */

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Self-play a seeded duel (random decks, tests/fuzz driver) on `wasm`. */
export async function recordSeeded(
  seed: number,
  mode: DuelMode,
  dataDirectory: string,
  maxSteps: number,
  wasm: ArrayBuffer,
): Promise<RecordedDuel> {
  const scenario = scenarioFor(seed, { mode, masterRule: null, maxSteps });
  startRecording();
  setWasmOverride(wasm);
  try {
    const outcome = await runDuel(scenario, dataDirectory);
    const setup = setupScenario(scenario, dataDirectory);
    return {
      scenario,
      engine: { mode: scenario.mode, masterRule: scenario.masterRule, decks: outcome.decks, seed: setup.engineSeed, firstTurnDraw: outcome.firstTurnDraw },
      journal: outcome.journal,
      deckNotes: outcome.deckNotes,
      disjoint: outcome.disjoint,
      note: outcome.failure ? `self-play ended early: ${outcome.failure.invariant}` : outcome.ended ? "duel ended" : "step cap",
    };
  } finally {
    setWasmOverride(null);
    stopRecording();
  }
}

/** Self-play a duel that starts from a compiled Layer 1 board, with the seeded driver of the fuzz test. */
export async function recordBoard(
  seed: number,
  scenarioId: string,
  compiled: CompiledBoard,
  engineSeed: string[],
  dataDirectory: string,
  maxSteps: number,
  wasm: ArrayBuffer,
): Promise<RecordedDuel> {
  const engine: EngineSpec = {
    mode: compiled.options.mode,
    firstTurnDraw: firstTurnDrawFor(compiled.options.mode, compiled.options.masterRule),
    ...(compiled.options.masterRule ? { masterRule: compiled.options.masterRule } : {}),
    decks: compiled.options.decks,
    seed: engineSeed,
    ...(compiled.options.settings ? { settings: compiled.options.settings } : {}),
    ...(compiled.options.startupScripts ? { startupScripts: compiled.options.startupScripts } : {}),
  };
  const journal: JournalEntry[] = [];
  let note = "step cap";
  startRecording();
  setWasmOverride(wasm);
  try {
    const game = await createEngineGame({ ...engine, dataDirectory, standardWasmBinary: wasm });
    try {
      const rng = new Rng(seed).fork(2);
      let views = readViews(game);
      let turnActions = 0;
      let toggleSteps = 0;
      let lastTurn = 0;
      try {
        for (let steps = 0; steps < maxSteps; steps++) {
          if (views.v0.result) {
            note = "duel ended";
            break;
          }
          const seat = views.v0.prompt ? 0 : views.v1.prompt ? 1 : -1;
          const prompt = seat === 0 ? views.v0.prompt : seat === 1 ? views.v1.prompt : null;
          if (seat < 0 || !prompt) {
            note = "self-play ended early: no prompt and no result";
            break;
          }
          if (views.v0.turn !== lastTurn) {
            lastTurn = views.v0.turn;
            turnActions = 0;
          }
          toggleSteps = prompt.kind === "toggle" ? toggleSteps + 1 : 0;
          const plan = planAnswer(prompt, { rng, turnActions, toggleSteps, searchCards: (q) => game.searchCards(q) });
          const revision = views.v0.revision;
          let accepted: DuelAnswer | null = null;
          for (const candidate of plan.candidates as DuelAnswer[]) {
            try {
              game.answer(seat, prompt.id, candidate);
              accepted = candidate;
              break;
            } catch (error) {
              if (!(error instanceof EngineAnswerError)) throw error;
            }
          }
          if (!accepted) {
            note = `self-play ended early: no accepted answer for "${prompt.title}"`;
            break;
          }
          journal.push({ seat, promptId: prompt.id, revision, answer: accepted });
          turnActions++;
          views = readViews(game);
        }
      } catch (error) {
        note = `self-play ended early: ${errorText(error)}`;
      }
    } finally {
      game.close();
    }
  } finally {
    setWasmOverride(null);
    stopRecording();
  }
  return {
    scenario: { seed, mode: engine.mode, masterRule: engine.masterRule ?? 5, maxSteps },
    engine,
    journal,
    deckNotes: ["board", "board"],
    disjoint: false,
    scenarioId,
    note,
  };
}

/** Replay a journal on `wasm` and record the trace. Throws on an engine error. */
export async function replayRecorded(recorded: RecordedDuel, dataDirectory: string, wasm: ArrayBuffer): Promise<{ trace: Trace; finalHash: string }> {
  const trace = startRecording();
  setWasmOverride(wasm);
  try {
    const game = await createEngineGame({ ...recorded.engine, dataDirectory, standardWasmBinary: wasm });
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
    setWasmOverride(null);
    stopRecording();
  }
}

export interface ExtendedSeedResult {
  seed: number;
  recorded: RecordedDuel;
  /** Second replay on the reference core (harness self-check). */
  reference: SeedResult;
  multi: SeedResult;
}

function clip(text: string, max = 1200): string {
  return text.length > max ? `${text.slice(0, max)}... (${text.length} chars)` : text;
}

/** Same comparison as `compareSeed` in harness.ts, for an already recorded duel. */
export async function compareRecorded(
  seed: number,
  recorded: RecordedDuel,
  dataDirectory: string,
  cores: { reference: ArrayBuffer; multi: ArrayBuffer },
): Promise<ExtendedSeedResult> {
  // The reference trace is a replay (not the self-play run) for the same reason as in harness.ts.
  const base = await replayRecorded(recorded, dataDirectory, cores.reference);
  const info = {
    seed,
    answers: recorded.journal.length,
    processSteps: base.trace.steps.length,
    messages: base.trace.steps.reduce((sum, step) => sum + step.raw.length, 0),
    note: recorded.note,
  };
  const warningsOf = (steps: Trace["steps"]) => steps.flatMap((step, index) => step.parseWarnings.map((text) => `step ${index}: ${text}`));
  const run = async (wasm: ArrayBuffer): Promise<SeedResult> => {
    try {
      const replay = await replayRecorded(recorded, dataDirectory, wasm);
      let diff: Diff | null = firstDiff(seed, base.trace, replay.trace);
      if (!diff && replay.finalHash !== base.finalHash) {
        diff = { seed, step: -1, kind: "views", message: "final views hash differs", expected: base.finalHash, actual: replay.finalHash };
      }
      return { ...info, diff, parseWarnings: warningsOf(replay.trace.steps) };
    } catch (error) {
      return {
        ...info,
        diff: { seed, step: -1, kind: "replay-error", message: "replay threw", expected: "no error", actual: clip(errorText(error)) },
        parseWarnings: [],
      };
    }
  };
  const reference = await run(cores.reference);
  const multi = await run(cores.multi);
  return { seed, recorded, reference, multi };
}
