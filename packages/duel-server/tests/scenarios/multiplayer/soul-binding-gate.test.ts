import { it } from "vitest";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { lpPairProofs, runLpPairScenario } from "./player-all-lp-pairs.js";

describeWithCores("live soul-binding-gate opponent binding", liveNseat, () => {
  for (const scenario of lpPairProofs(6909330)) it(scenario.id, () => runLpPairScenario(scenario));
});
