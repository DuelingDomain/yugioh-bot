import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { UNDERWORLD_CIRCLE_STANDBY_SCENARIOS } from "./underworld-circle-standby.js";

describeWithCores("live Underworld Circle Standby summons", liveNseat, () => {
  runScenarios("multiplayer/underworld-circle-standby", UNDERWORLD_CIRCLE_STANDBY_SCENARIOS);
});
