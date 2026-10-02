import { it } from "vitest";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { PLAYER_ALL_LP_PAIR_SCENARIOS, runLpPairScenario } from "./player-all-lp-pairs.js";

const STOCK_CARDS = [49407319, 65430834, 81143465, 83555666, 89693655];
describeWithCores("live stock LP pair controls", liveNseat, () => {
  for (const scenario of PLAYER_ALL_LP_PAIR_SCENARIOS.filter(row => STOCK_CARDS.some(code => row.tags.includes(`card:${code}`))))
    it(scenario.id, () => runLpPairScenario(scenario));
});
