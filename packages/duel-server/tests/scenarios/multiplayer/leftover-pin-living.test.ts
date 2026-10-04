import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { LEFTOVER_PIN_LIVING_SCENARIOS } from "./leftover-pin-living.js";
describeWithCores("live Pin Baller living LP Standard", liveNseat, () => {
  runScenarios("multiplayer/leftover-pin-living", LEFTOVER_PIN_LIVING_SCENARIOS);
});
describeWithCores("live Pin Baller living LP Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/leftover-pin-living-domain", LEFTOVER_PIN_LIVING_SCENARIOS.map(domainVariant));
});
