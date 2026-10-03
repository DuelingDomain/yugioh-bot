import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { RED_NOVA_BURNING_SOUL_SCENARIOS } from "./red-nova-burning-soul.js";

describeWithCores("Standard live Red Nova Dragon - Burning Soul", liveNseat, () => {
  runScenarios("multiplayer/red-nova-burning-soul", RED_NOVA_BURNING_SOUL_SCENARIOS);
});
describeWithCores("Domain live Red Nova Dragon - Burning Soul", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/red-nova-burning-soul-domain", RED_NOVA_BURNING_SOUL_SCENARIOS.map(domainVariant));
});
