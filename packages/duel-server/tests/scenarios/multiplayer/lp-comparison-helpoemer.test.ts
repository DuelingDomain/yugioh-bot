import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { HELPOEMER_LP_SCENARIOS } from "./lp-comparison-helpoemer.js";

describeWithCores("live Helpoemer LP comparison", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/lp-comparison-helpoemer", HELPOEMER_LP_SCENARIOS);
});
