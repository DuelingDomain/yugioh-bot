import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { EACH_PLAYER_LP_RESPONSE_SCENARIOS } from "./each-player-lp-responses.js";
describeWithCores("live each-player LP responses", liveNseat, () => { runScenarios("multiplayer/each-player-lp-responses", EACH_PLAYER_LP_RESPONSE_SCENARIOS); });
