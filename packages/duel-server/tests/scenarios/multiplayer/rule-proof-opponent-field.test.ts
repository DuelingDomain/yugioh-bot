import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { OPPONENT_FIELD_DOMAIN_PROOF_SCENARIOS, OPPONENT_FIELD_NON_NEXT_PROOF_SCENARIOS } from "./rule-proof-opponent-field.js";

describeWithCores("live declared opponent at another FFA seat", liveNseat, () => {
  runScenarios("multiplayer/rule-proof-opponent-field-non-next", OPPONENT_FIELD_NON_NEXT_PROOF_SCENARIOS);
});

describeWithCores("live all-opponent field rule in Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-opponent-field", OPPONENT_FIELD_DOMAIN_PROOF_SCENARIOS);
});
