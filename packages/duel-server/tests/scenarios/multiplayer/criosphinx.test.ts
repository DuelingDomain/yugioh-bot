import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { CRIOSPHINX_SCENARIOS } from "./criosphinx.js";
describeWithCores("live Criosphinx owners", liveNseat, () => {
  runScenarios("multiplayer/criosphinx", CRIOSPHINX_SCENARIOS);
});
