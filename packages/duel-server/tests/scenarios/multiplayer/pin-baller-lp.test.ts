import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { PIN_BALLER_LP_SCENARIOS } from "./pin-baller-lp.js";

describeWithCores("live Pin Baller LP protection", liveNseat, () => {
  runScenarios("multiplayer/pin-baller-lp", PIN_BALLER_LP_SCENARIOS);
});
