import { runScenarios } from "../../support/runner.js";
import { BUJINKI_DETACH_STATE_SCENARIOS } from "./bujinki-detach-state.js";

describeWithCores("live Bujinki detach state", liveNseat, () => { runScenarios("multiplayer/bujinki-detach-state", BUJINKI_DETACH_STATE_SCENARIOS); });
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { domainVariant } from "./domain-variants.js";

describeWithCores("live Domain Bujinki detach state", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/bujinki-detach-state-domain", BUJINKI_DETACH_STATE_SCENARIOS.map(domainVariant));
});
