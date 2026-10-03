import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { LEFTOVER_REVIVAL_ELIGIBILITY_SCENARIOS } from "./leftover-revival-eligibility.js";
describeWithCores("leftover eligibility Standard", liveNseat, () => runScenarios("leftover/eligibility", LEFTOVER_REVIVAL_ELIGIBILITY_SCENARIOS));
describeWithCores("leftover eligibility Domain", [liveNseat, ...needs.domainMulti()], () => runScenarios("leftover/eligibility-domain", LEFTOVER_REVIVAL_ELIGIBILITY_SCENARIOS.map(domainVariant)));
