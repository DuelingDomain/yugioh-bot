import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_SHARED_CARD_PROOF_SCENARIOS } from "./rule-proof-tag-shared-cards.js";
describeWithCores("live Tag shared card rule proof", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-tag-shared-cards", TAG_SHARED_CARD_PROOF_SCENARIOS);
});
