import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { MECHA_DOG_MARRON_SCENARIOS } from "./mecha-dog-marron.js";
describeWithCores("live Mecha-Dog Marron damage", liveNseat, () => {
  runScenarios("multiplayer/mecha-dog-marron", MECHA_DOG_MARRON_SCENARIOS);
});
