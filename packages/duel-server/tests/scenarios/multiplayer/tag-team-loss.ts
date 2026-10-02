// Tag team loss by an empty Deck (review gap "team loss edge cases"): the other cases of R-TAG-LOSS that nseat-tag.ts does not play.
// nseat-tag-deck-out-loses-team lets every Deck run out at the same pace, so p1 is the first seat to find an empty Deck. Here ONE
// member runs out alone, by Pot of Greed, while the other members still have cards: the whole team of that member loses, whichever
// seat it is (p0, the partner p2, or a seat of team 1) and whatever the Deck of the partner holds. The cases that no official card
// can make (EFFECT_CANNOT_LOSE_LP and EFFECT_CANNOT_LOSE_DECK on one member, both teams at 0) are proven by the native check
// scripts/native/checks/tag-team-loss.cpp. Plain data (scripts/rule-coverage.ts reads it); tag-team-loss.test.ts runs it live.
// Every Deck has 3 cards and p0 skips its draw of turn 1. Draws: p0 on turns 5, 9; p1 on 2, 6, 10; p2 on 3, 7, 11; p3 on 4, 8, 12.

import {
  activate, defineScenario, endTurn, expectBoard, expectEliminated, expectResult, expectTurn,
  type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";

const passTurns = (...seats: Seat[]): Step[] => seats.map((seat) => endTurn(seat));
const POT = "Pot of Greed";

export const TAG_TEAM_LOSS_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "tag-team-loss-p0-deck-out-takes-the-partner",
    title: "Tag: p0 draws the last cards of its Deck by Pot of Greed and must draw from an empty Deck at turn 9: team 0 loses (p2 still has a card), team 1 wins",
    source: `${SOURCE} [R-TAG-LOSS]`,
    rules: ["R-TAG-LOSS"],
    tags: ["multiplayer", "elimination", "draw", "tag", "card:55144522"],
    setup: { format: "tag", deckSize: 3, p0: { hand: [POT] } },
    steps: [
      activate(POT, "p0"),
      // p0 has 3 cards, Pot of Greed draws 2, the draw of turn 5 takes the last one.
      expectBoard({ p0: { deckCount: 1, hand: { count: 2 } }, p1: { deckCount: 3 }, p2: { deckCount: 3 }, p3: { deckCount: 3 } }),
      ...passTurns("p0", "p1", "p2", "p3"),
      expectTurn("p0", 5),
      expectBoard({ p0: { deckCount: 0 }, p1: { deckCount: 2 }, p2: { deckCount: 2 }, p3: { deckCount: 2 } }),
      ...passTurns("p0", "p1", "p2"),
      // Before the draw of turn 9, p0 is empty and p2 still has 1 card. Elimination clears both Decks from the final view.
      expectBoard({ p0: { deckCount: 0, lp: 16000 }, p1: { deckCount: 1, lp: 16000 }, p2: { deckCount: 1, lp: 16000 }, p3: { deckCount: 1, lp: 16000 } }),
      endTurn("p3"),
      // The draw of turn 9: only p0 finds an empty Deck, and both members of team 0 lose.
      expectEliminated("p0", "p2"),
      expectResult({ team: 1 }),
      expectBoard({ p0: { deckCount: 0, lp: 16000 }, p1: { deckCount: 1, lp: 16000 }, p2: { deckCount: 0, lp: 16000 }, p3: { deckCount: 1, lp: 16000 } }),
    ],
  }),
  defineScenario({
    id: "tag-team-loss-p2-deck-out-while-p0-has-cards",
    title: "Tag: p2 empties its Deck by Pot of Greed and must draw at turn 7 while p0 still has 2 cards in its Deck: team 0 loses, team 1 wins",
    source: `${SOURCE} [R-TAG-LOSS]`,
    rules: ["R-TAG-LOSS"],
    tags: ["multiplayer", "elimination", "draw", "tag", "card:55144522"],
    setup: { format: "tag", deckSize: 3, p2: { hand: [POT] } },
    steps: [
      ...passTurns("p0", "p1"),
      expectTurn("p2", 3),
      // The draw of turn 3 leaves 2 cards, Pot of Greed draws both: the Deck of p2 is empty. p0 has not drawn yet (it draws on turn 5).
      activate(POT, "p2"),
      expectBoard({ p2: { deckCount: 0 }, p0: { deckCount: 3 }, p1: { deckCount: 2 }, p3: { deckCount: 3 } }),
      ...passTurns("p2", "p3", "p0", "p1"),
      // Turn 7 is p2 again: it must draw from an empty Deck and loses. The Deck of p0 held 2 cards (it drew once, on turn 5).
      expectEliminated("p0", "p2"),
      expectResult({ team: 1 }),
      expectBoard({ p1: { deckCount: 1, lp: 16000 }, p3: { deckCount: 2, lp: 16000 } }),
    ],
  }),
  defineScenario({
    id: "tag-team-loss-p3-deck-out-while-p1-has-cards",
    title: "Tag: p3 empties its Deck by Pot of Greed and must draw at turn 8 while p1 still has a card: team 1 loses, team 0 wins",
    source: `${SOURCE} [R-TAG-LOSS]`,
    rules: ["R-TAG-LOSS"],
    tags: ["multiplayer", "elimination", "draw", "tag", "card:55144522"],
    setup: { format: "tag", deckSize: 3, p3: { hand: [POT] } },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      expectTurn("p3", 4),
      activate(POT, "p3"),
      expectBoard({ p3: { deckCount: 0 }, p0: { deckCount: 3 }, p1: { deckCount: 2 }, p2: { deckCount: 2 } }),
      ...passTurns("p3", "p0", "p1", "p2"),
      // Turn 8 is p3 again: it loses with p1. p0 drew on turn 5 (2 cards left) and p2 on turns 3 and 7 (1 card left).
      expectEliminated("p1", "p3"),
      expectResult({ team: 0 }),
      expectBoard({ p0: { deckCount: 2, lp: 16000 }, p2: { deckCount: 1, lp: 16000 } }),
    ],
  }),
];
