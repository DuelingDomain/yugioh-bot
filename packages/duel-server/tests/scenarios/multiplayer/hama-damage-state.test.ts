import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { HAMA_DAMAGE_STATE_SCENARIOS } from "./hama-damage-state.js";

describeWithCores("live Hama damage state", liveNseat, () => {
  runScenarios("multiplayer/hama-damage-state", HAMA_DAMAGE_STATE_SCENARIOS);
});
