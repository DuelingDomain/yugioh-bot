import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { LEFTOVER_CRETIN_COVERAGE_SCENARIOS } from "./leftover-cretin-coverage.js";
describeWithCores("leftover Cretin Standard", liveNseat, () => runScenarios("leftover/cretin", LEFTOVER_CRETIN_COVERAGE_SCENARIOS));
describeWithCores("leftover Cretin Domain", [liveNseat, ...needs.domainMulti()], () => runScenarios("leftover/cretin-domain", LEFTOVER_CRETIN_COVERAGE_SCENARIOS.map(domainVariant)));
