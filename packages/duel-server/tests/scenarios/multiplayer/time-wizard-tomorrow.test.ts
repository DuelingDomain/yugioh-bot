import { it } from "vitest";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { lpPairProofs, runLpPairScenario } from "./player-all-lp-pairs.js";

describeWithCores("live time-wizard-tomorrow opponent binding", liveNseat, () => {
  for (const scenario of lpPairProofs(26273196)) it(scenario.id, () => runLpPairScenario(scenario));
});
