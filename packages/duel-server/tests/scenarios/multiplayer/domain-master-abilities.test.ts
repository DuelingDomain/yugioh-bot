import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_MASTER_ABILITY_SCENARIOS } from "./domain-master-abilities.js";

describeWithCores("live Domain Deck Master card abilities", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-master-abilities", DOMAIN_MASTER_ABILITY_SCENARIOS);
});
