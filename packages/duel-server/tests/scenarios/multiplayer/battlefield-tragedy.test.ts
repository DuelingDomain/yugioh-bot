import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { BATTLEFIELD_TRAGEDY_SCENARIOS } from "./battlefield-tragedy.js";

describeWithCores("live Battlefield Tragedy scenarios", liveNseat, () => {
  runScenarios("multiplayer/battlefield-tragedy", BATTLEFIELD_TRAGEDY_SCENARIOS);
});
describeWithCores("live Domain Battlefield Tragedy scenarios", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/battlefield-tragedy-domain", BATTLEFIELD_TRAGEDY_SCENARIOS.map(domainVariant));
});
