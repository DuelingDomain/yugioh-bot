import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { LEFTOVER_REVIVAL_ORDER_SCENARIOS } from "./leftover-revival-order.js";
describeWithCores("leftover revival Standard", liveNseat, () => runScenarios("leftover/revival", LEFTOVER_REVIVAL_ORDER_SCENARIOS));
describeWithCores("leftover revival Domain", [liveNseat, ...needs.domainMulti()], () => runScenarios("leftover/revival-domain", LEFTOVER_REVIVAL_ORDER_SCENARIOS.map(domainVariant)));
