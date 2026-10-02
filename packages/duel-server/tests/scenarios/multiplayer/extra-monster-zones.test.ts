import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { EXTRA_MONSTER_ZONE_SCENARIOS } from "./extra-monster-zones.js";

describeWithCores("live multiplayer Extra Monster Zones", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/extra-monster-zones", EXTRA_MONSTER_ZONE_SCENARIOS);
});
