import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { LEFTOVER_CLEAR_MAINTENANCE_SCENARIOS } from "./leftover-clear-maintenance.js";
describeWithCores("leftover Clear World Standard", liveNseat, () => runScenarios("leftover/clear", LEFTOVER_CLEAR_MAINTENANCE_SCENARIOS));
describeWithCores("leftover Clear World Domain", [liveNseat, ...needs.domainMulti()], () => runScenarios("leftover/clear-domain", LEFTOVER_CLEAR_MAINTENANCE_SCENARIOS.map(domainVariant)));
