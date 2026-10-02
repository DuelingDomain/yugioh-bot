import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { EACH_PLAYER_LP_SIMPLE_SCENARIOS } from "./each-player-lp-simple.js";
describeWithCores("live each-player simple LP effects", liveNseat, () => {
  runScenarios("multiplayer/each-player-lp-simple", EACH_PLAYER_LP_SIMPLE_SCENARIOS);
});
