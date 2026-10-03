import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_ORDER_PROOF_SCENARIOS } from "./rule-proof-tag-order.js";

describeWithCores("live Tag order rule", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/rule-proof-tag-order", TAG_ORDER_PROOF_SCENARIOS);
});
