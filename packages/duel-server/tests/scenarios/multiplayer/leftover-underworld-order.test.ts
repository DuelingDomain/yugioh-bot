import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { LEFTOVER_UNDERWORLD_ORDER_SCENARIOS } from "./leftover-underworld-order.js";
describeWithCores("leftover Underworld Standard", liveNseat, () => runScenarios("leftover/underworld", LEFTOVER_UNDERWORLD_ORDER_SCENARIOS));
describeWithCores("leftover Underworld Domain", [liveNseat, ...needs.domainMulti()], () => runScenarios("leftover/underworld-domain", LEFTOVER_UNDERWORLD_ORDER_SCENARIOS.map(domainVariant)));
