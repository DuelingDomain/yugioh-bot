import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { P3_EXTRA_DECK_SCENARIOS } from "./p3-extra-deck.js";

describeWithCores("declared opponent Extra Deck proofs", liveNseat, () => {
  runScenarios("multiplayer/p3-extra-deck", P3_EXTRA_DECK_SCENARIOS);
});
