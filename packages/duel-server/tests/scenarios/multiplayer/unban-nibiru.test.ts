import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { UNBAN_NIBIRU_SCENARIOS } from "./unban-nibiru.js";

describeWithCores("Nibiru owner rule on real Standard and Domain multi cores", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/unban-nibiru", UNBAN_NIBIRU_SCENARIOS);
});
