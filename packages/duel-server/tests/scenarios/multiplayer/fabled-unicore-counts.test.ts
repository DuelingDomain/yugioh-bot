import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FABLED_UNICORE_COUNTS_SCENARIOS } from "./fabled-unicore-counts.js";

describeWithCores("live Fabled Unicore hand comparisons", liveNseat, () => {
  runScenarios("multiplayer/fabled-unicore-counts", FABLED_UNICORE_COUNTS_SCENARIOS);
});
