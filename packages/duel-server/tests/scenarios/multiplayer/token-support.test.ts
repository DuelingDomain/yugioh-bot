import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TOKEN_SUPPORT_SCENARIOS } from "./token-support.js";

describeWithCores("Standard Token Support", liveNseat, () => {
  runScenarios("multiplayer/token-support", TOKEN_SUPPORT_SCENARIOS);
});

describeWithCores("Domain Token Support", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/token-support-domain", TOKEN_SUPPORT_SCENARIOS.map(domainVariant));
});
