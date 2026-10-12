import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_EXTRA_DM_SUMMON_SCENARIOS } from "./domain-extra-dm-summon.js";

describeWithCores("live Synchro, Xyz and Fusion Deck Master summons from the zone", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-extra-dm-summon", DOMAIN_EXTRA_DM_SUMMON_SCENARIOS);
});
