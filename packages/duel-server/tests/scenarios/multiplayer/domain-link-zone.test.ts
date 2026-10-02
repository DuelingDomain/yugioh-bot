import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_LINK_ZONE_SCENARIOS } from "./domain-link-zone.js";

describeWithCores("live Link Deck Master summon from its zone and recall", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-link-zone", DOMAIN_LINK_ZONE_SCENARIOS);
});
