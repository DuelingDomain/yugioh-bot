// Finger Game: the owner exception to R-COMMON-EACH-PLAYER (R-COMMON-OPP-PICK). The activator picks ONE opponent. Only those
// two duelists place 2 cards, declare a number from 0 to 4 and excavate 2 cards, as in 1v1. The other duelists are not affected.
import {
  activate, auto, expectBoard, number, pickOpponent, select,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

type Format = "ffa3" | "tag";
const FINGER = "Finger Game";
const DECKS: Record<string, [string, string]> = {
  p0: ["Giant Rat", "Battle Ox"],
  p1: ["Axe Raider", "Silver Fang"],
  p2: ["Mystical Elf", "Hane-Hane"],
  p3: ["Beaver Warrior", "Celtic Guardian"],
};

function fingerGame(format: Format): Scenario {
  const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  // p0 picks p1. In Tag p1 is one duelist of the other team (p0 and p2 are a team, p1 and p3 are a team).
  const chosen: DuelistId = "p1";
  const lp = format === "tag" ? 16000 : 8000;
  const setup: Scenario["setup"] = { format, skipOpeningDraw: true, deckSize: 2 };
  const board: BoardExpect = {};
  for (const s of seats) {
    setup[s] = { hand: s === "p0" ? [FINGER] : [], deck: [...DECKS[s]] };
    board[s] = { lp, hand: [], monsters: [], spells: [], banished: [], grave: [], deckCount: 2 };
  }
  board.p0 = { ...board.p0, hand: [DECKS.p0[0]], grave: [FINGER], deckCount: 1 };
  const steps: Step[] = [
    activate(FINGER, "p0"),
    pickOpponent(chosen, "p0"),
    // The Spell zone is picked. The 2 cards of each Deck are the only candidates, so no card prompt opens for the placing.
    auto("p0"),
    number(4, "p0"), number(0, chosen),
    // 4 monsters were excavated: p0 declared 4 and adds 1 card to the hand. p1 declared 0 and puts its 2 cards back in order.
    select("Giant Rat"), auto(chosen),
    expectBoard(board),
  ];
  return defineScenario({
    id: `finger-game-${format}-only-the-chosen-opponent-plays`,
    title: `${format.toUpperCase()}: p0 activates Finger Game and picks ${chosen}; only p0 and ${chosen} place, declare and excavate (4 cards, numbers 0 to 4); the other duelists keep their Decks`,
    source: `${SOURCE} [R-COMMON-OPP-PICK]`, rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-pick", format, "card:100464005"], setup, steps,
  });
}

// Tag Deck rule: "your Deck" is the own Deck of one duelist (R-TAG-SHARED-CARDS). p1 has 1 card in the Deck and its partner p3 has 2.
// p1 cannot place 2 cards, so p1 is not offered. The Deck of p3 is not read in place of the Deck of p1, so p3 stays the only opponent.
function fingerGameTagShortDeck(): Scenario {
  const setup: Scenario["setup"] = { format: "tag", skipOpeningDraw: true, deckSize: 2 };
  const board: BoardExpect = {};
  for (const s of ["p0", "p1", "p2", "p3"] as DuelistId[]) {
    setup[s] = { hand: s === "p0" ? [FINGER] : [], deck: s === "p1" ? [DECKS.p1[0]] : [...DECKS[s]], deckSize: s === "p1" ? 1 : 2 };
    board[s] = { lp: 16000, hand: [], monsters: [], spells: [], banished: [], grave: [], deckCount: s === "p1" ? 1 : 2 };
  }
  board.p0 = { ...board.p0, hand: [DECKS.p0[0]], grave: [FINGER], deckCount: 1 };
  const steps: Step[] = [
    activate(FINGER, "p0"),
    // Only p3 can place 2 cards, so there is nothing to pick: the activation binds p3 and goes on to the numbers.
    auto("p0"),
    number(4, "p0"), number(0, "p3"),
    select("Giant Rat"), auto("p3"),
    expectBoard(board),
  ];
  return defineScenario({
    id: "finger-game-tag-short-deck-opponent-not-offered",
    title: "TAG: p1 has 1 Deck card and its partner p3 has 2; Finger Game offers only p3 and never reads the Deck of the partner for p1",
    source: `${SOURCE} [R-COMMON-OPP-PICK]`, rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-pick", "tag", "card:100464005"], setup, steps,
  });
}

export const FINGER_GAME_SCENARIOS: Scenario[] = [fingerGame("ffa3"), fingerGame("tag"), fingerGameTagShortDeck()];
