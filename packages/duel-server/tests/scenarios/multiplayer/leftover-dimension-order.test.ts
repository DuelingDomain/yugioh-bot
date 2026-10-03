import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { LEFTOVER_DIMENSION_ORDER_SCENARIOS } from "./leftover-dimension-order.js";
describeWithCores("leftover Dimension Standard", liveNseat, () => runScenarios("leftover/dimension", LEFTOVER_DIMENSION_ORDER_SCENARIOS));
describeWithCores("leftover Dimension Domain", [liveNseat, ...needs.domainMulti()], () => runScenarios("leftover/dimension-domain", LEFTOVER_DIMENSION_ORDER_SCENARIOS.map(domainVariant)));
