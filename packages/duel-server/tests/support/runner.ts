import { describe, it } from "vitest";
import type { Scenario } from "./dsl.js";
import { expectKnownFailure, knownGapLabel, type KnownGap } from "./expected-failure.js";
import { isSelected } from "./select.js";
import { runScenario } from "./session.js";

/**
 * Register scenarios as Vitest tests. Scenarios with `knownBug` run as `it.fails`: they stay green
 * while the engine bug exists and fail when it is fixed, so the marker gets removed.
 * Scenarios not chosen by the SCENARIO_* filters are skipped.
 * `expectedFailures` (scenario id to KnownGap) marks scenarios that fail until a core patch lands. Unlike knownBug,
 * such a scenario is green only for the failure that the gap names. Any other failure stays red.
 */
export function runScenarios(suite: string, scenarios: Scenario[], run = runScenario, expectedFailures: Record<string, KnownGap> = {}): void {
  describe(suite, () => {
    for (const scenario of scenarios) {
      const name = `${scenario.id}: ${scenario.title}`;
      let selected = true;
      try {
        selected = isSelected(scenario);
      } catch (error) {
        // A bad card name is reported by the test body below; keep the scenario in the run.
        void error;
      }
      if (!selected) {
        it.skip(name, () => undefined);
      } else if (expectedFailures[scenario.id]) {
        const gap = expectedFailures[scenario.id]!;
        it(`${name} [${knownGapLabel(gap)}]`, async () => {
          await expectKnownFailure(gap, () => run(scenario));
        });
      } else if (scenario.knownBug) {
        it.fails(`${name} [known bug: ${scenario.knownBug}]`, async () => {
          await run(scenario);
        });
      } else {
        it(name, async () => {
          await run(scenario);
        });
      }
    }
  });
}
