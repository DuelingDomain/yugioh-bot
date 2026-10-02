import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAI_BATTLE_CONTROLLER_SCENARIOS } from "./tai-battle-controller.js";
describeWithCores("live TA.I. battle controller", liveNseat, () => { runScenarios("multiplayer/tai-battle-controller", TAI_BATTLE_CONTROLLER_SCENARIOS); });
