import { it } from "vitest";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { lpPairProofs, runLpPairScenario } from "./player-all-lp-pairs.js";

import { eventLpOpponentProofs } from "./event-lp-opponent.js";

describeWithCores("live cooling-embers opponent binding", liveNseat, () => {
  for (const scenario of [...lpPairProofs(83819309), ...eventLpOpponentProofs(83819309)]) it(scenario.id, () => runLpPairScenario(scenario));
});
