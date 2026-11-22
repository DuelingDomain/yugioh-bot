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

export const FINGER_GAME_SCENARIOS: Scenario[] = [fingerGame("ffa3"), fingerGame("tag")];
