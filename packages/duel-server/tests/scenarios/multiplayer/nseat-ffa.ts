// FFA3 and FFA4 end states on a real engine (NSEAT_LIVE=1, see nseat-live.test.ts). Plain data, also read by
// scripts/rule-coverage.ts. Natural eliminations only (battle damage, effect damage, drawing from an empty Deck): no
// Debug.EliminateDuelist. Real cards: Hinotama (500 damage, opponent pick), Mind Crush (opponent pick, hand), Heavy Storm and
// Dust Tornado (the chain). Every scenario asserts a FINAL state after an action.

import {
  activate, announce, attack, changePhase, defineScenario, endTurn, expectBoard, expectChain, expectEliminated, expectLp,
  expectPickSeats, expectPrompt, expectResolved, expectResponseOrder, expectResult, expectTurn, pass, pickOpponent,
  select, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, ELF_ATK, SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
const passTurns = (...seats: Seat[]): Step[] => seats.map((seat) => endTurn(seat));
const GONE = { hand: { count: 0 }, spells: { count: 0 }, monsters: { count: 0 }, grave: { count: 0 } };

export const FFA_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "nseat-ffa4-battle-elimination-skips-turn",
    title: "FFA4: battle damage takes a seat to 0 LP, the seat is eliminated, its cards leave and its turn is skipped",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "battle", "ffa4"],
    setup: {
      format: "ffa4",
      p0: { monsters: [ELF] },
      p1: { lp: ELF_ATK, hand: [ELF], spells: [{ card: "Dark Hole", pos: "set" }], grave: ["Raigeki"] },
    },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      expectTurn("p0", 5),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p1", "p0"),
      expectEliminated("p1"),
      expectBoard({ p1: { lp: 0, ...GONE }, p0: { lp: 8000, monsters: [ELF] }, p2: { lp: 8000 }, p3: { lp: 8000 } }),
      // The turn goes p0, then p2 (p1 is skipped), then p3, then p0.
      endTurn("p0"),
      expectTurn("p2", 6),
      endTurn("p2"),
      expectTurn("p3", 7),
      endTurn("p3"),
      expectTurn("p0", 8),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-effect-elimination-skips-turn",
    title: "FFA4: effect damage (Hinotama) takes the picked seat to 0 LP, it is eliminated and its turn is skipped",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "effect-damage", "ffa4", "card:46130346"],
    setup: {
      format: "ffa4",
      p0: { hand: ["Hinotama"] },
      p2: { lp: 500, hand: [ELF], grave: ["Raigeki"], spells: [{ card: "Dark Hole", pos: "set" }] },
    },
    steps: [
      activate("Hinotama", "p0"),
      expectPickSeats(["p1", "p2", "p3"], "p0"),
      pickOpponent("p2", "p0"),
      expectEliminated("p2"),
      expectBoard({ p2: { lp: 0, ...GONE }, p1: { lp: 8000 }, p3: { lp: 8000 }, p0: { lp: 8000, grave: ["Hinotama"] } }),
      endTurn("p0"),
      expectTurn("p1", 2),
      endTurn("p1"),
      // p2 is skipped. The turn number counts the turns played.
      expectTurn("p3", 3),
      endTurn("p3"),
      expectTurn("p0", 4),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-effect-elimination-last-wins",
    title: "FFA3: two Hinotama take both opponents to 0 LP, the last living seat wins and the second hit asks for no pick",
    source: `${SOURCE} [R-FFA-WINNER]`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-WINNER"],
    tags: ["multiplayer", "elimination", "effect-damage", "ffa3", "card:46130346"],
    setup: { format: "ffa3", p0: { hand: ["Hinotama", "Hinotama"] }, p1: { lp: 500 }, p2: { lp: 500 } },
    steps: [
      activate("Hinotama", "p0"),
      pickOpponent("p1", "p0"),
      expectEliminated("p1"),
      expectBoard({ p2: { lp: 500 }, p0: { lp: 8000 } }),
      // One opponent is left: the opponent is that seat, no pick.
      activate("Hinotama", "p0"),
      expectEliminated("p1", "p2"),
      expectResult({ seat: "p0" }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-own-turn-battle-elimination-hands-on-turn",
    title: "FFA3: the turn player loses the last LP in their own battle, is eliminated and the turn goes to the next living seat",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "battle", "turn-order", "ffa3"],
    setup: {
      format: "ffa3",
      p0: { monsters: [ELF], lp: 300 },
      p1: { monsters: [{ card: "Giant Rat", pos: "atk" }] },
      p2: { monsters: [{ card: "Giant Rat", pos: "atk" }] },
    },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      expectTurn("p0", 4),
      changePhase("battle", "p0"),
      attack(ELF, { card: "Giant Rat", owner: "p1" }, "p0"),
      expectEliminated("p0"),
      expectBoard({ p0: { lp: 0, ...GONE }, p1: { monsters: ["Giant Rat"] }, p2: { monsters: ["Giant Rat"] } }),
      // The own turn of p0 ends at once: the next living seat is p1.
      expectTurn("p1", 5),
      endTurn("p1"),
      expectTurn("p2", 6),
      endTurn("p2"),
      // p0 stays skipped.
      expectTurn("p1", 7),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-deck-out-elimination",
    title: "FFA3: a seat that must draw from an empty Deck is eliminated, the turn goes on and the others play on",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "draw", "ffa3", "card:55144522"],
    // Deck of 3. p0 does not draw on turn 1 and plays Pot of Greed (draws 2, 1 card left). The turn 4 draw empties the Deck of
    // p0. At turn 7 p0 must draw and loses; p1 and p2 still have a card (they draw on turns 2, 5 and 3, 6).
    setup: { format: "ffa3", deckSize: 3, p0: { hand: ["Pot of Greed"] } },
    steps: [
      activate("Pot of Greed", "p0"),
      expectBoard({ p0: { hand: { count: 2 }, deckCount: 1 } }),
      ...passTurns("p0", "p1", "p2", "p0", "p1", "p2"),
      expectEliminated("p0"),
      // The LP of p0 is not changed by a deck-out. Turn 7 was the turn of p0 (lost at its draw): turn 8 is p1, who has drawn the
      // last card of its Deck.
      expectBoard({ p0: GONE, p1: { deckCount: 0 }, p2: { deckCount: 1 } }),
      expectTurn("p1", 8),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-deck-out-all-lose-last-wins",
    title: "FFA3: two seats with an empty Deck lose at their draw, the last one wins",
    source: `${SOURCE} [R-FFA-WINNER]`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-WINNER"],
    tags: ["multiplayer", "elimination", "draw", "ffa3"],
    setup: { format: "ffa3", deckSize: 1 },
    steps: [
      // p0 skipped the draw on turn 1 and draws its only card on turn 4. p1 and p2 drew their only card on turns 2 and 3: at the
      // draw of turn 5 p1 has no card and loses, and the turn goes on to p2, who loses at once.
      ...passTurns("p0", "p1", "p2", "p0"),
      expectEliminated("p1", "p2"),
      expectResult({ seat: "p0" }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-mind-crush-pick-after-elimination",
    title: "FFA4: the opponent pick of Mind Crush lists the living opponents only, and only the picked seat discards",
    source: `${SOURCE} [R-COMMON-OPP-PICK]`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-pick", "elimination", "ffa4", "card:15800838", "card:46130346"],
    setup: {
      format: "ffa4",
      p0: { hand: ["Hinotama", ELF], spells: [{ card: "Mind Crush", pos: "set" }] },
      p1: { hand: ["Sangan"] },
      p2: { hand: ["Sangan"] },
      p3: { lp: 500, hand: ["Sangan"] },
    },
    steps: [
      activate("Hinotama", "p0"),
      pickOpponent("p3", "p0"),
      // The set Mind Crush is offered as a response to Hinotama: p0 passes.
      pass("p0"),
      expectEliminated("p3"),
      activate("Mind Crush", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p1", "p0"),
      announce("Sangan", "p0"),
      expectBoard({ p1: { hand: { count: 0 }, grave: ["Sangan"] }, p2: { hand: ["Sangan"] }, p0: { hand: [ELF] } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-mind-crush-pick",
    title: "FFA3: Mind Crush asks which opponent, and the effect hits only the picked seat",
    source: `${SOURCE} [R-COMMON-OPP-PICK]`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-pick", "ffa3", "card:15800838"],
    setup: {
      format: "ffa3",
      p0: { hand: [ELF], spells: [{ card: "Mind Crush", pos: "set" }] },
      p1: { hand: ["Sangan"] },
      p2: { hand: ["Sangan"] },
    },
    steps: [
      activate("Mind Crush", "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      announce("Sangan", "p0"),
      expectBoard({ p2: { hand: { count: 0 }, grave: ["Sangan"] }, p1: { hand: ["Sangan"] }, p0: { hand: [ELF] } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-direct-attack-pick-skips-dead",
    title: "FFA4: the direct-attack pick offers the three opponents, and after an elimination the living two only",
    source: `${SOURCE} [R-FFA-ATTACK]`,
    rules: ["R-FFA-ATTACK", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "battle", "direct-attack", "elimination", "ffa4"],
    setup: { format: "ffa4", p0: { monsters: [ELF, ELF] }, p2: { lp: ELF_ATK } },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      expectPickSeats(["p1", "p2", "p3"], "p0"),
      pickOpponent("p2", "p0"),
      expectEliminated("p2"),
      // p2 is out: the second attack never offers it.
      attack(ELF, "direct", "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      expectBoard({ p3: { lp: 8000 - ELF_ATK }, p1: { lp: 8000 }, p2: { lp: 0 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-turn-numbers-and-first-round-no-attack",
    title: "FFA4: turns 1 to 8 go p0, p1, p2, p3 twice, nobody can attack before turn 5, p0 can on turn 5",
    source: `${SOURCE} [R-FFA-ORDER] [R-FFA-NO-ATTACK]`,
    rules: ["R-FFA-ORDER", "R-FFA-NO-ATTACK"],
    tags: ["multiplayer", "turn-order", "battle", "ffa4"],
    setup: { format: "ffa4", p0: { monsters: [ELF] }, p1: { monsters: [ELF] }, p2: { monsters: [ELF] }, p3: { monsters: [ELF] } },
    steps: [
      expectTurn("p0", 1), expectPrompt({ by: "p0", notOffers: ["to_bp"] }),
      endTurn("p0"), expectTurn("p1", 2), expectPrompt({ by: "p1", notOffers: ["to_bp"] }),
      endTurn("p1"), expectTurn("p2", 3), expectPrompt({ by: "p2", notOffers: ["to_bp"] }),
      endTurn("p2"), expectTurn("p3", 4), expectPrompt({ by: "p3", notOffers: ["to_bp"] }),
      endTurn("p3"), expectTurn("p0", 5), expectPrompt({ by: "p0", offers: ["to_bp"] }),
      changePhase("battle", "p0"),
      attack(ELF, { card: ELF, owner: "p2" }, "p0"),
      // Equal ATK: both Elves are destroyed. The Elves of p1 and p3 stay.
      expectBoard({ p0: { monsters: { count: 0 } }, p2: { monsters: { count: 0 } }, p1: { monsters: [ELF] }, p3: { monsters: [ELF] } }),
      endTurn("p0"),
      expectTurn("p1", 6),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-four-way-chain-order",
    title: "FFA4: Heavy Storm gets responses from three seats in the order p1, p2, p3 and resolves in reverse",
    source: `${SOURCE} [R-FFA-CHAIN]`,
    rules: ["R-FFA-CHAIN"],
    tags: ["multiplayer", "chain", "ffa4", "card:19613556", "card:60082869"],
    setup: {
      format: "ffa4",
      p0: { hand: ["Heavy Storm"], spells: [0, 1, 2].map(() => ({ card: "Swords of Revealing Light", pos: "up" as const })) },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
      p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
      p3: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    },
    steps: [
      activate("Heavy Storm", "p0"),
      activate("Dust Tornado", "p1"),
      select({ card: "Swords of Revealing Light", nth: 0 }),
      activate("Dust Tornado", "p2"),
      select({ card: "Swords of Revealing Light", nth: 1 }),
      // p3 has the window with three links on the chain.
      expectChain("Heavy Storm", "Dust Tornado", "Dust Tornado"),
      activate("Dust Tornado", "p3"),
      select({ card: "Swords of Revealing Light", nth: 2 }),
      // p0 has no card to answer with, so it gets no prompt: the chain resolves.
      expectResponseOrder("p1", "p2", "p3"),
      expectResolved("Dust Tornado", "Dust Tornado", "Dust Tornado", "Heavy Storm"),
      expectBoard({
        p0: { spells: { count: 0 }, grave: { include: ["Heavy Storm", "Swords of Revealing Light"] } },
        p1: { spells: { count: 0 }, grave: ["Dust Tornado"] },
        p2: { spells: { count: 0 }, grave: ["Dust Tornado"] },
        p3: { spells: { count: 0 }, grave: ["Dust Tornado"] },
      }),
    ],
  }),
];

