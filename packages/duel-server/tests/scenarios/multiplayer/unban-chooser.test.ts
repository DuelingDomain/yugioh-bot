import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { UNBAN_CHOOSER_SCENARIOS } from "./unban-chooser.js";

describeWithCores("owner 2026-10-18 opponent choice", liveNseat, () => {
  runScenarios("multiplayer/unban-chooser", UNBAN_CHOOSER_SCENARIOS);
});
