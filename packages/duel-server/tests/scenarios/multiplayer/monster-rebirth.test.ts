import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { MONSTER_REBIRTH_SCENARIOS } from "./monster-rebirth.js";

describeWithCores("live Monster Rebirth scenarios", liveNseat, () => {
  runScenarios("multiplayer/monster-rebirth", MONSTER_REBIRTH_SCENARIOS);
});
describeWithCores("live Domain Monster Rebirth scenarios", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/monster-rebirth-domain", MONSTER_REBIRTH_SCENARIOS.map(domainVariant));
});
