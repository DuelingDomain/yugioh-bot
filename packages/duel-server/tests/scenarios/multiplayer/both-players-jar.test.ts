import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { BOTH_PLAYERS_JAR_SCENARIOS } from "./both-players-jar.js";

describeWithCores("live Cyber Jar with 3 and 4 duelists", liveNseat, () => {
  runScenarios("multiplayer/both-players-jar", BOTH_PLAYERS_JAR_SCENARIOS);
});
