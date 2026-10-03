import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { IRON_CORE_OWNER_SCENARIOS } from "./iron-core-owner.js";

describeWithCores("live Iron Core owner", liveNseat, () => {
  runScenarios("multiplayer/iron-core-owner", IRON_CORE_OWNER_SCENARIOS);
});
