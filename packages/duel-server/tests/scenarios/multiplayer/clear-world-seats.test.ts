import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { CLEAR_WORLD_SEAT_SCENARIOS } from "./clear-world-seats.js";

describeWithCores("live Clear World seats", liveNseat, () => {
  runScenarios("multiplayer/clear-world-seats", CLEAR_WORLD_SEAT_SCENARIOS);
});
