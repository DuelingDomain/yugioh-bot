import { describe, expect, it } from "vitest";
import { engineDataDirectory, type Scenario } from "./config.js";
import { describeFailure } from "./failures.js";
import { runAndVerify } from "./run-one.js";

/**
 * Fuzz seeds that found real defects. Each one plays and replays a full duel with every invariant on.
 * A seed depends on the card pool and the pinned card data: when those change, a seed may stop
 * reaching its old board. Keep the entry, it still plays one more duel.
 */
const REGRESSIONS: Array<Scenario & { defect: string }> = [
  {
    defect: "stale reason_effect: a lost-target destroy read a freed effect (core use-after-free, Lua error)",
    seed: 10, mode: "domain", masterRule: 5, maxSteps: 400,
  },
  {
    defect: "stale reason_effect, Master Rule 3",
    seed: 10, mode: "domain", masterRule: 3, maxSteps: 400,
  },
  {
    defect: "Conscription excavated the opponent's Deck, but only the Deck owner saw the excavation",
    seed: 927017171, mode: "normal", masterRule: 2, maxSteps: 400,
  },
  {
    defect: "hands stay public (Ceremonial Bell) until the core's next adjust step",
    seed: 1438435519, mode: "domain", masterRule: 3, maxSteps: 400,
  },
  {
    defect: "hands stay public (Ceremonial Bell) until the core's next adjust step, Master Rule 1",
    seed: 1438435519, mode: "domain", masterRule: 1, maxSteps: 400,
  },
  {
    defect: "an attack flipped a Set monster face-up and it went to the Deck before the next check (checker only)",
    seed: 1656513885, mode: "domain", masterRule: 2, maxSteps: 400,
  },
];

describe("fuzz regression seeds", () => {
  const dataDirectory = engineDataDirectory();
  for (const { defect, ...scenario } of REGRESSIONS) {
    it(`seed ${scenario.seed} ${scenario.mode} MR${scenario.masterRule}: ${defect}`, async () => {
      const outcome = await runAndVerify(scenario, dataDirectory, 1);
      expect(outcome.failure ? describeFailure(outcome, dataDirectory) : null).toBeNull();
      expect(outcome.steps).toBeGreaterThan(20);
    }, 120_000);
  }
});
