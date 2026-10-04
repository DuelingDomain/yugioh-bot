import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { SWORDS_PROTECT_SCENARIOS } from "./swords-protect.js";

describeWithCores("live Swords controller protection", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/swords-protect", SWORDS_PROTECT_SCENARIOS);
});
