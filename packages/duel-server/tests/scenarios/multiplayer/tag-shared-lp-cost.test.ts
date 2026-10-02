import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_SHARED_LP_COST_SCENARIOS } from "./tag-shared-lp-cost.js";

describeWithCores("live Tag LP costs", liveNseat, () => {
  runScenarios("multiplayer/tag-shared-lp-cost", TAG_SHARED_LP_COST_SCENARIOS);
});
describeWithCores("live Domain Tag LP costs", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-shared-lp-cost-domain", TAG_SHARED_LP_COST_SCENARIOS.map(domainVariant));
});
