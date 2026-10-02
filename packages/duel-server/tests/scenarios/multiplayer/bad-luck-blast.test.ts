import { it } from "vitest";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { lpPairProofs, runLpPairScenario } from "./player-all-lp-pairs.js";

describeWithCores("live bad-luck-blast opponent binding", liveNseat, () => {
  for (const scenario of lpPairProofs(76004142)) it(scenario.id, () => runLpPairScenario(scenario));
});
