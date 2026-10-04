import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { QUEUED_BOUND_OPPONENT_SCENARIOS } from "./queued-bound-opponent.js";

describeWithCores("queued causal opponent after surrender", liveNseat, () => {
  runScenarios("multiplayer/queued-bound-opponent", QUEUED_BOUND_OPPONENT_SCENARIOS);
});
