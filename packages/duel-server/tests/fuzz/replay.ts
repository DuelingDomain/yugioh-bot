import { createEngineGame, eliminationCodeOf } from "../../src/engine.js";
import { readViews, setupScenario, type DuelOutcome } from "./driver.js";
import { viewsHash } from "./invariants.js";

export interface ReplayResult {
  ok: boolean;
  message?: string;
  step?: number;
}

/**
 * Rebuild the duel from the scenario seed and feed the journal through the same path the duel host
 * uses to recover a duel (`buildReplay` in src/host.ts): same options and seed, then for each
 * command check revision and prompt id, then answer. The view hash of every step must match.
 * Rejected answers are not journaled, so a rejection that changed core state would show up here.
 */
export async function replayDuel(outcome: DuelOutcome, dataDirectory: string): Promise<ReplayResult> {
  const setup = setupScenario(outcome.scenario, dataDirectory);
  const game = await createEngineGame({
    mode: outcome.scenario.mode,
    firstTurnDraw: outcome.firstTurnDraw,
    masterRule: outcome.scenario.masterRule,
    decks: setup.decks,
    seed: setup.engineSeed,
    dataDirectory,
  });
  try {
    const opening = viewsHash(readViews(game));
    if (outcome.stepHashes[0] && opening !== outcome.stepHashes[0]) return { ok: false, step: 0, message: "Opening board differs on replay" };
    for (let i = 0; i < outcome.journal.length; i++) {
      const command = outcome.journal[i]!;
      const view = game.view(command.seat);
      if (view.revision !== command.revision) return { ok: false, step: i, message: `Revision ${view.revision} differs from journal ${command.revision}` };
      const elimination = eliminationCodeOf(command.promptId);
      if (elimination === null && view.prompt?.id !== command.promptId) return { ok: false, step: i, message: `Prompt ${view.prompt?.id ?? "none"} differs from journal ${command.promptId}` };
      if (elimination === null) game.answer(command.seat, command.promptId, command.answer);
      else game.eliminate(command.seat, elimination);
      const expected = outcome.stepHashes[i + 1];
      if (expected && viewsHash(readViews(game)) !== expected) return { ok: false, step: i + 1, message: "Views differ from the original run" };
    }
    const final = viewsHash(readViews(game));
    if (final !== outcome.finalHash) return { ok: false, step: outcome.journal.length, message: "Final view hash differs on replay" };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `Replay threw: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    game.close();
  }
}
