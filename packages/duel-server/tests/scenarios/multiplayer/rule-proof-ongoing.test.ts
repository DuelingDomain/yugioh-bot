import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ONGOING_PROOF_SCENARIOS } from "./rule-proof-ongoing.js";
describeWithCores("live FFA4 ongoing rule proof", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-ongoing", ONGOING_PROOF_SCENARIOS);
});
