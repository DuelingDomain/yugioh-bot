import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { POSSESSED_DESTINY_SCENARIOS } from "./possessed-destiny.js";

describeWithCores("live Possessed Destiny with 3 duelists", liveNseat, () => {
  runScenarios("multiplayer/possessed-destiny", POSSESSED_DESTINY_SCENARIOS);
});
