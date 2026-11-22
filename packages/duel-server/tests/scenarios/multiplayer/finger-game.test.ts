import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FINGER_GAME_SCENARIOS } from "./finger-game.js";

describeWithCores("live Finger Game with 3 and 4 duelists", liveNseat, () => {
  runScenarios("multiplayer/finger-game", FINGER_GAME_SCENARIOS);
});
