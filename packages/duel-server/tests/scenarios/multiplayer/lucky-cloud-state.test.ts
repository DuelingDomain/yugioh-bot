import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { LUCKY_CLOUD_STATE_SCENARIOS } from "./lucky-cloud-state.js";

describeWithCores("live Lucky Cloud summon state", liveNseat, () => {
  runScenarios("multiplayer/lucky-cloud-state", LUCKY_CLOUD_STATE_SCENARIOS);
});
