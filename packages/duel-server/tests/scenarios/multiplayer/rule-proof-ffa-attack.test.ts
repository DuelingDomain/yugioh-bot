import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FFA_ATTACK_DOMAIN_PROOF_SCENARIOS } from "./rule-proof-ffa-attack.js";

describeWithCores("live FFA4 attack rule in Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-ffa-attack", FFA_ATTACK_DOMAIN_PROOF_SCENARIOS);
});
