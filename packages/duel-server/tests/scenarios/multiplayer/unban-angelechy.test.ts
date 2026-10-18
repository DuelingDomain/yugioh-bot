import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { UNBAN_ANGELECHY_SCENARIOS } from "./unban-angelechy.js";

describeWithCores("live Angelechy Opposition eligible opponent choice", liveNseat, () => {
  runScenarios("multiplayer/unban-angelechy", UNBAN_ANGELECHY_SCENARIOS);
});
