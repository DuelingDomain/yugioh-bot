import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { EACH_PLAYER_LP_AMOUNT_SCENARIOS } from "./each-player-lp-amounts.js";
describeWithCores("live each-player LP amounts", liveNseat, () => { runScenarios("multiplayer/each-player-lp-amounts", EACH_PLAYER_LP_AMOUNT_SCENARIOS); });
