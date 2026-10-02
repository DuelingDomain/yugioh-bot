import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ALL_PLAYER_DECKS_SCENARIOS } from "./all-player-decks.js";

describeWithCores("live all-player Deck actions", liveNseat, () => {
  runScenarios("multiplayer/all-player-decks", ALL_PLAYER_DECKS_SCENARIOS);
});
