import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { P3_CATALOG_SCENARIOS } from "./p3-catalog.js";

describeWithCores("declared-opponent catalog outcomes", liveNseat, () => {
  runScenarios("multiplayer/p3-catalog", P3_CATALOG_SCENARIOS);
});
