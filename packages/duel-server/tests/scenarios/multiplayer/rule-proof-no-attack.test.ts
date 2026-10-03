import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { NO_ATTACK_PROOF_SCENARIOS } from "./rule-proof-no-attack.js";
describeWithCores("live FFA first attack rule proof", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-no-attack", NO_ATTACK_PROOF_SCENARIOS);
});
