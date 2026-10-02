import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { CHEATAH_CONTROLLER_SCENARIOS } from "./cheatah-controller.js";
describeWithCores("live Cheatah controller", liveNseat, () => { runScenarios("multiplayer/cheatah-controller", CHEATAH_CONTROLLER_SCENARIOS); });
