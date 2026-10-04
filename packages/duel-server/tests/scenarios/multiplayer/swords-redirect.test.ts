import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { SWORDS_REDIRECT_SCENARIOS } from "./swords-redirect.js";
describeWithCores("live stock redirect-to-direct regression", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/swords-redirect", SWORDS_REDIRECT_SCENARIOS);
});
