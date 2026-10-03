import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { FLAME_WINGMAN_SCENARIOS } from "./flame-wingman.js";

describeWithCores("Standard Favorite HERO Flame Wingman", liveNseat, () => {
  runScenarios("multiplayer/flame-wingman", FLAME_WINGMAN_SCENARIOS);
});

describeWithCores("Domain Favorite HERO Flame Wingman", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/flame-wingman-domain", FLAME_WINGMAN_SCENARIOS.map(domainVariant));
});
