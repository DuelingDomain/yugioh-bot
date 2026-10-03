import type { Scenario } from "./config.js";
import { runDuel, type DuelOutcome } from "./driver.js";
import { replayDuel } from "./replay.js";

/** Whether this seed is in the replay sample. Deterministic, so a repro replays the same way. */
export function shouldReplay(seed: number, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return ((Math.imul(seed, 2654435761) >>> 0) % 10000) / 10000 < rate;
}

export interface VerifiedOutcome extends DuelOutcome {
  replayed: boolean;
  replayMs: number;
}

/** Play one duel, check invariants at every step, then replay it and compare hashes. */
export async function runAndVerify(scenario: Scenario, dataDirectory: string, replayRate: number, options: { firstTurnDraw?: boolean } = {}): Promise<VerifiedOutcome> {
  const replay = shouldReplay(scenario.seed, replayRate);
  const outcome = (await runDuel(scenario, dataDirectory, { ...options, collectHashes: replay })) as VerifiedOutcome;
  outcome.replayed = false;
  outcome.replayMs = 0;
  if (replay && !outcome.failure && outcome.journal.length > 0) {
    const t0 = performance.now();
    const result = await replayDuel(outcome, dataDirectory);
    outcome.replayMs = performance.now() - t0;
    outcome.replayed = true;
    if (!result.ok) {
      outcome.failure = {
        invariant: "replay-determinism",
        message: result.message ?? "Replay diverged",
        step: result.step ?? 0,
      };
    }
  }
  // Hashes are only needed for the replay check.
  outcome.stepHashes = [];
  return outcome;
}
