import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FFA_TRIGGER_PROOF_SCENARIOS } from "./rule-proof-ffa-triggers.js";
describeWithCores("live FFA trigger rule proof", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-ffa-triggers", FFA_TRIGGER_PROOF_SCENARIOS);
});
