import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { WORM_CONTROLLER_SCENARIOS } from "./worm-controller.js";
describeWithCores("live worm-controller", liveNseat, () => { runScenarios("multiplayer/worm-controller", WORM_CONTROLLER_SCENARIOS); });
