import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ARCANA_TARGET_CONTROLLER_SCENARIOS } from "./arcana-target-controller.js";
describeWithCores("live Arcana target controller", liveNseat, () => { runScenarios("multiplayer/arcana-target-controller", ARCANA_TARGET_CONTROLLER_SCENARIOS); });
