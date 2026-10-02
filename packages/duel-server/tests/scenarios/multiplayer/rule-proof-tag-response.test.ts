import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_RESPONSE_DOMAIN_PROOF_SCENARIOS } from "./rule-proof-tag-response.js";

describeWithCores("live Tag response rule in Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-tag-response", TAG_RESPONSE_DOMAIN_PROOF_SCENARIOS);
});
