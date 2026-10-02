import {describeWithCores} from "../../support/cores.js";
import {liveNseat} from "../../support/live-nseat.js";
import {runScenarios} from "../../support/runner.js";
import {PLAYER_ALL_OVERLAY_LP_SCENARIOS} from "./player-all-overlay-lp.js";
describeWithCores("live PLAYER_ALL overlay LP outcomes",liveNseat,()=>{runScenarios("multiplayer/player-all-overlay-lp",PLAYER_ALL_OVERLAY_LP_SCENARIOS);});
