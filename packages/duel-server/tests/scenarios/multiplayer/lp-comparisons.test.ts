import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { LP_COMPARISON_SCENARIOS } from "./lp-comparisons.js";

describeWithCores("live multiplayer LP comparisons", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/lp-comparisons", LP_COMPARISON_SCENARIOS);
});
