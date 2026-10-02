import { describe, it } from "vitest";
import type { Scenario } from "./dsl.js";
import { isSelected } from "./select.js";
import { runScenario } from "./session.js";

/**
 * Register scenarios as Vitest tests. Scenarios with `knownBug` run as `it.fails`: they stay green
 * while the engine bug exists and fail when it is fixed, so the marker gets removed.
 * Scenarios not chosen by the SCENARIO_* filters are skipped.
 */
export function runScenarios(suite: string, scenarios: Scenario[], run = runScenario): void {
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
