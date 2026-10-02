import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { OPPONENT_FIELD_DOMAIN_PROOF_SCENARIOS } from "./rule-proof-opponent-field.js";

describeWithCores("live all-opponent field rule in Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-opponent-field", OPPONENT_FIELD_DOMAIN_PROOF_SCENARIOS);
});
