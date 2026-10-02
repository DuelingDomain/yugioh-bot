import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { CHAOS_EMPEROR_TAG_SCENARIOS } from "./chaos-emperor-tag.js";

describeWithCores("live Chaos Emperor Dragon all Tag hands", liveNseat, () => {
  runScenarios("multiplayer/chaos-emperor-tag", CHAOS_EMPEROR_TAG_SCENARIOS);
});
