import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { PLAYER_ALL_LP_PAIR_SCENARIOS, runLpPairScenario } from "./player-all-lp-pairs.js";

describeWithCores("live LP pair controls", liveNseat, () => {
  runScenarios("multiplayer/player-all-lp-pairs", PLAYER_ALL_LP_PAIR_SCENARIOS, runLpPairScenario);
});
