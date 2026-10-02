import { it } from "vitest";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenario } from "../../support/session.js";
import { UNDERWORLD_CIRCLE_STANDBY_SCENARIOS } from "./underworld-circle-standby.js";

describeWithCores("live Underworld Circle Standby summons", liveNseat, () => {
  for (const scenario of UNDERWORLD_CIRCLE_STANDBY_SCENARIOS) {
    it(scenario.id, async () => { await runScenario(scenario); });
  }
});
