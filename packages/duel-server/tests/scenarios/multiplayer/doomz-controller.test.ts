import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOOMZ_CONTROLLER_SCENARIOS } from "./doomz-controller.js";
describeWithCores("live doomz-controller", liveNseat, () => { runScenarios("multiplayer/doomz-controller", DOOMZ_CONTROLLER_SCENARIOS); });
