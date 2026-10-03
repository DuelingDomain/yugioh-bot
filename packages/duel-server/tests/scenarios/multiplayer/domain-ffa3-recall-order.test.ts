import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_FFA3_RECALL_ORDER_SCENARIOS } from "./domain-ffa3-recall-order.js";

describeWithCores("live Domain FFA3 simultaneous Deck Master recalls", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-ffa3-recall-order", DOMAIN_FFA3_RECALL_ORDER_SCENARIOS);
});
