import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { EACH_PLAYER_LP_TRIGGER_SCENARIOS } from "./each-player-lp-triggers.js";
describeWithCores("live each-player LP card triggers", liveNseat, () => {
  runScenarios("multiplayer/each-player-lp-triggers", EACH_PLAYER_LP_TRIGGER_SCENARIOS);
});
