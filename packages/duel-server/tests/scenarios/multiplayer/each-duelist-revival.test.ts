import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { EACH_DUELIST_REVIVAL_SCENARIOS } from "./each-duelist-revival.js";

describeWithCores("live revival of every duelist", liveNseat, () => {
  runScenarios("multiplayer/each-duelist-revival", EACH_DUELIST_REVIVAL_SCENARIOS);
});
