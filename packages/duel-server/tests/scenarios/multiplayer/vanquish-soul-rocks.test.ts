import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { VANQUISH_SOUL_ROCKS_SCENARIOS } from "./vanquish-soul-rocks.js";

describeWithCores("Standard live Vanquish Soul Rocks", liveNseat, () => {
  runScenarios("multiplayer/vanquish-soul-rocks", VANQUISH_SOUL_ROCKS_SCENARIOS);
});
describeWithCores("Domain live Vanquish Soul Rocks", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/vanquish-soul-rocks-domain", VANQUISH_SOUL_ROCKS_SCENARIOS.map(domainVariant));
});
