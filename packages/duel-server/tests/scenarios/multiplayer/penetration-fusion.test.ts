import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { PENETRATION_FUSION_SCENARIOS } from "./penetration-fusion.js";

describeWithCores("Standard Penetration Fusion", liveNseat, () => {
  runScenarios("multiplayer/penetration-fusion", PENETRATION_FUSION_SCENARIOS);
});

describeWithCores("Domain Penetration Fusion", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/penetration-fusion-domain", PENETRATION_FUSION_SCENARIOS.map(domainVariant));
});
