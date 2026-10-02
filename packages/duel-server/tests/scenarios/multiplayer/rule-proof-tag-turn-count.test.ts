import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_TURN_COUNT_DOMAIN_PROOF_SCENARIOS } from "./rule-proof-tag-turn-count.js";

describeWithCores("live Tag turn-count rule in Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-tag-turn-count", TAG_TURN_COUNT_DOMAIN_PROOF_SCENARIOS);
});
