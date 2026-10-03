// FFA3 and FFA4 end states on a real engine (NSEAT_LIVE=1, see nseat-live.test.ts). Plain data, also read by
// scripts/rule-coverage.ts. Natural eliminations only (battle damage, effect damage, drawing from an empty Deck): no
// Debug.EliminateDuelist. Real cards: Hinotama (500 damage, opponent pick), Mind Crush (opponent pick, hand), Heavy Storm and
// Dust Tornado (the chain). Every scenario asserts a FINAL state after an action.

import {
  activate, announce, attack, changePhase, changePosition, endTurn, expectBoard, expectChain, expectEliminated, expectLp, expectNotOffered,
  expectPickSeats, expectPrompt, expectResolved, expectResponseOrder, expectResult, expectTurn, pass, pickOpponent,
  select, surrender, yes, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { ELF, ELF_ATK, SOURCE } from "./nseat-scenarios.js";

const DESTRUCTION_RING = { card: "Destruction Ring", pos: "set" as const };

type Seat = "p0" | "p1" | "p2" | "p3";
const passTurns = (...seats: Seat[]): Step[] => seats.map((seat) => endTurn(seat));
/** A set trap that can be activated opens optional chain windows at turn changes: decline this many. */
const declineWindows = (seat: Seat, count: number): Step[] => Array.from({ length: count }, () => pass(seat));
// What the VIEW shows for an eliminated seat: projectView returns an empty seat without a read of the core (src/views.ts,
// emptySeatView). A check against VIEW_EMPTY proves the projection, NOT that the core released the cards. The scenarios that prove
// the rule itself read an outcome from the core: an ongoing effect that stops, a link that has no effect, a stolen monster that leaves.
const VIEW_EMPTY = { hand: { count: 0 }, spells: { count: 0 }, monsters: { count: 0 }, grave: { count: 0 } };

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
      expectBoard({ p1: { lp: 0, ...VIEW_EMPTY }, p0: { lp: 8000, monsters: [ELF] }, p2: { lp: 8000 }, p3: { lp: 8000 } }),
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
      expectBoard({ p2: { lp: 0, ...VIEW_EMPTY }, p1: { lp: 8000 }, p3: { lp: 8000 }, p0: { lp: 8000, grave: ["Hinotama"] } }),
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
      expectBoard({ p0: { lp: 0, ...VIEW_EMPTY }, p1: { monsters: ["Giant Rat"] }, p2: { monsters: ["Giant Rat"] } }),
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
    // Standard MR5 skips p0's turn-1 draw. Pot of Greed draws both cards. The turn-4 draw eliminates p0.
    setup: { format: "ffa3", masterRule: 5, deckSize: 2, p0: { hand: ["Pot of Greed"] } },
    steps: [
      expectBoard({ p0: { hand: ["Pot of Greed"], deckCount: 2 } }),
      activate("Pot of Greed", "p0"),
      expectBoard({ p0: { hand: { count: 2 }, deckCount: 0 } }),
      ...passTurns("p0", "p1", "p2"),
      expectEliminated("p0"),
      // Deck-out keeps p0's LP. p1 draws its second card on turn 5; p2 has drawn one card.
      expectBoard({ p0: { lp: 8000, ...VIEW_EMPTY }, p1: { lp: 8000, hand: { count: 2 }, deckCount: 0 }, p2: { lp: 8000, hand: { count: 1 }, deckCount: 1 } }),
      expectTurn("p1", 5),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-deck-out-all-lose-last-wins",
    title: "FFA3: two seats with an empty Deck lose at their draw, the last one wins",
    source: `${SOURCE} [R-FFA-WINNER]`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-WINNER"],
    tags: ["multiplayer", "elimination", "draw", "ffa3"],
    setup: { format: "ffa3", masterRule: 5, deckSize: 2, p0: { hand: ["Pot of Greed"] } },
    steps: [
      // Standard MR5 skips p0's turn-1 draw. Pot of Greed empties its Deck before the turn-4 draw.
      activate("Pot of Greed", "p0"),
      expectBoard({ p0: { hand: { count: 2 }, deckCount: 0 }, p1: { deckCount: 2 }, p2: { deckCount: 2 } }),
      ...passTurns("p0", "p1", "p2"),
      expectEliminated("p0"),
      expectTurn("p1", 5),
      expectBoard({ p0: { lp: 8000, ...VIEW_EMPTY }, p1: { hand: { count: 2 }, deckCount: 0 }, p2: { hand: { count: 1 }, deckCount: 1 } }),
      // p2 draws its last card on turn 6. p1 must draw from an empty Deck on turn 7, so p2 wins.
      ...passTurns("p1", "p2"),
      expectEliminated("p0", "p1"),
      expectBoard({ p0: { lp: 8000, ...VIEW_EMPTY }, p1: { lp: 8000, ...VIEW_EMPTY }, p2: { lp: 8000, hand: { count: 2 }, deckCount: 0 } }),
      expectResult({ seat: "p2" }),
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
    title: "FFA4: after p2 adds a link the turn player p0 answers first, then p1, p2 and p3, and the chain resolves in reverse",
    source: `${SOURCE} [R-FFA-CHAIN]`,
    rules: ["R-FFA-CHAIN"],
    tags: ["multiplayer", "chain", "ffa4", "card:19613556", "card:60082869"],
    // Every seat holds a Dust Tornado, so every window is a real prompt. Under the ADR order the windows are p1, p2 (the turn
    // player p0 added Heavy Storm, so the next seat goes first), then after the link of p2: p0 (turn player first), p1, p2, p3. A plain
    // "next seat after the one who added the link" order would give p3, p0, p1 there.
    setup: {
      format: "ffa4",
      p0: {
        hand: ["Heavy Storm"],
        spells: [{ card: "Dust Tornado", pos: "set" }, ...[0, 1].map(() => ({ card: "Swords of Revealing Light", pos: "up" as const }))],
      },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
      p2: { spells: [{ card: "Dust Tornado", pos: "set" }, { card: "Dust Tornado", pos: "set" }] },
      p3: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    },
    steps: [
      activate("Heavy Storm", "p0"),
      pass("p1"),
      activate("Dust Tornado", "p2"),
      // R-FFA-OPP-ONE: declare the owner before selecting its Spell.
      pickOpponent("p0", "p2"),
      select({ card: "Swords of Revealing Light", nth: 0 }),
      expectChain("Heavy Storm", "Dust Tornado"),
      expectPrompt({ by: "p0", context: "chain" }), pass("p0"),
      expectPrompt({ by: "p1", context: "chain" }), pass("p1"),
      expectPrompt({ by: "p2", context: "chain" }), pass("p2"),
      expectPrompt({ by: "p3", context: "chain" }), pass("p3"),
      expectResponseOrder("p1", "p2", "p0", "p1", "p2", "p3"),
      expectResolved("Dust Tornado", "Heavy Storm"),
      // Dust Tornado of p2 destroyed one Swords. Heavy Storm then destroyed the other Spells and Traps, the set ones too.
      expectBoard({
        p0: { spells: { count: 0 }, grave: { include: ["Heavy Storm", "Swords of Revealing Light", "Dust Tornado"] } },
        p1: { spells: { count: 0 }, grave: ["Dust Tornado"] },
        p2: { spells: { count: 0 }, grave: ["Dust Tornado", "Dust Tornado"] },
        p3: { spells: { count: 0 }, grave: ["Dust Tornado"] },
      }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-four-way-chain-three-links",
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
      // R-FFA-OPP-ONE: declare the owner before selecting its Spell.
      pickOpponent("p0", "p1"),
      select({ card: "Swords of Revealing Light", nth: 0 }),
      activate("Dust Tornado", "p2"),
      // R-FFA-OPP-ONE: declare the owner before selecting its Spell.
      pickOpponent("p0", "p2"),
      select({ card: "Swords of Revealing Light", nth: 1 }),
      // p3 has the window with three links on the chain.
      expectChain("Heavy Storm", "Dust Tornado", "Dust Tornado"),
      activate("Dust Tornado", "p3"),
      // R-FFA-OPP-ONE: declare the owner before selecting its Spell.
      pickOpponent("p0", "p3"),
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
  defineScenario({
    id: "nseat-ffa3-eliminated-ongoing-effect-stops",
    title: "FFA3: the ongoing effect of an eliminated seat (Swords of Revealing Light) stops, so p0 can attack",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "ongoing", "ffa3", "card:72302403", "card:46130346"],
    // The next scenario has the same board with p1 alive: there Swords holds p0 back. Here p1 is out and the attack goes through.
    setup: { format: "ffa3", p0: { monsters: [ELF], hand: ["Hinotama"] }, p1: { lp: 500, spells: [{ card: "Swords of Revealing Light", pos: "up" }] } },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      activate("Hinotama", "p0"),
      pickOpponent("p1", "p0"),
      expectEliminated("p1"),
      // One opponent is left, so the attack needs no pick.
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      expectBoard({ p2: { lp: 8000 - ELF_ATK }, p0: { lp: 8000 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-living-seat-ongoing-effect-holds",
    title: "FFA3 control: the same Swords of Revealing Light of a living seat gives p0 no attack",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "ongoing", "ffa3", "card:72302403", "card:46130346"],
    setup: { format: "ffa3", p0: { monsters: [ELF], hand: ["Hinotama"] }, p1: { lp: 5000, spells: [{ card: "Swords of Revealing Light", pos: "up" }] } },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      activate("Hinotama", "p0"),
      pickOpponent("p1", "p0"),
      expectBoard({ p1: { lp: 4500 } }),
      // p1 lives, so Swords holds: the Battle Phase opens but the Elf has no attack.
      changePhase("battle", "p0"),
      expectNotOffered("attack", ELF, "p0"),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-eliminated-chain-link-has-no-effect",
    title: "FFA4: the Heavy Storm link of a seat that is eliminated by a response resolves with no effect",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "chain", "ffa4", "card:19613556", "card:24068492"],
    // On turn 2 p1 (500 LP, one monster) plays Heavy Storm. p0 answers with Just Desserts (500 damage per monster).
    // Only p1 controls a monster. The effect binds p1 with no pick. p1 loses while its link is on the chain.
    // That link must have no effect: the Swords of p2 stays.
    // The set Just Desserts opens four optional windows for p0 (its End Phase and the draw of p1): they are declined.
    setup: {
      format: "ffa4",
      p0: { spells: [{ card: "Just Desserts", pos: "set" }] },
      p1: { lp: 500, hand: ["Heavy Storm"], monsters: [ELF] },
      p2: { spells: [{ card: "Swords of Revealing Light", pos: "up" }] },
    },
    steps: [
      endTurn("p0"), ...declineWindows("p0", 4),
      expectTurn("p1", 2),
      activate("Heavy Storm", "p1"),
      expectPrompt({ by: "p0", context: "chain" }),
      activate("Just Desserts", "p0"),
      expectEliminated("p1"),
      expectBoard({ p2: { spells: ["Swords of Revealing Light"] } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-living-seat-chain-link-resolves",
    title: "FFA4 control: the same Heavy Storm link of a seat that survives the Just Desserts destroys the Swords of p2",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "chain", "ffa4", "card:19613556", "card:24068492"],
    setup: {
      format: "ffa4",
      p0: { spells: [{ card: "Just Desserts", pos: "set" }] },
      p1: { lp: 8000, hand: ["Heavy Storm"], monsters: [ELF] },
      p2: { spells: [{ card: "Swords of Revealing Light", pos: "up" }] },
    },
    steps: [
      endTurn("p0"), ...declineWindows("p0", 4),
      expectTurn("p1", 2),
      activate("Heavy Storm", "p1"),
      activate("Just Desserts", "p0"),
      expectBoard({ p1: { lp: 7500 } }),
      expectEliminated(),
      expectBoard({ p2: { spells: { count: 0 }, grave: ["Swords of Revealing Light"] } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-eliminated-seat-monster-under-control-leaves",
    title: "FFA3: a monster that p0 took from p1 with Change of Heart leaves the game when p1 is eliminated",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "control", "ffa3", "card:4031928", "card:46130346"],
    // The view of p0 is a living seat, so it reads the core: the check on p0.monsters is a real read of the field.
    setup: { format: "ffa3", p0: { hand: ["Change of Heart", "Hinotama"] }, p1: { lp: 500, monsters: [ELF] } },
    steps: [
      activate("Change of Heart", "p0"),
      expectBoard({ p0: { monsters: [ELF] }, p1: { monsters: { count: 0 } } }),
      activate("Hinotama", "p0"),
      expectEliminated("p1"),
      // The Elf belongs to p1: it is gone from the field of p0, who controls it.
      expectBoard({ p0: { monsters: { count: 0 }, lp: 8000 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-surrender-own-link-has-no-effect",
    title: "FFA4: a seat that gives up while its Dust Tornado link is on the chain loses, and the link resolves with no effect",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "chain", "surrender", "ffa4", "card:55144522", "card:60082869"],
    // p0 plays Pot of Greed. p1 answers with Dust Tornado on the Swords of p0 and holds a second Dust Tornado, so p1 has the next
    // window (the adder also gets a chance). p1 gives up there. The loss only lands after the chain, but the link of p1 must do
    // nothing already: the core negates the link of a seat with a pending loss (core patch "pending loss link").
    setup: {
      format: "ffa4",
      p0: { hand: ["Pot of Greed"], spells: [{ card: "Swords of Revealing Light", pos: "up" }] },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }, { card: "Dust Tornado", pos: "set" }] },
    },
    steps: [
      activate("Pot of Greed", "p0"),
      activate("Dust Tornado", "p1"),
      select({ card: "Swords of Revealing Light" }),
      expectChain("Pot of Greed", "Dust Tornado"),
      expectPrompt({ by: "p1", context: "chain" }),
      surrender("p1"),
      expectEliminated("p1"),
      // Pot of Greed still resolves. The Swords of p0 must still be there (Dust Tornado had no effect).
      expectBoard({ p0: { hand: { count: 2 }, grave: ["Pot of Greed"], spells: ["Swords of Revealing Light"] } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-surrender-keeps-chain-window-of-other-seat",
    title: "FFA4: a seat that gives up while another seat holds a chain window does not take that window away",
    source: `${SOURCE} [R-FFA-CHAIN]`,
    rules: ["R-FFA-CHAIN", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "chain", "surrender", "ffa4", "card:55144522", "card:60082869"],
    // p0 plays Pot of Greed, p1 answers with Dust Tornado. p2 holds a set Dust Tornado and the next window. p1 gives up now.
    // p2 must still get its window (the loss of p1 does not change the right of p2 to answer).
    setup: {
      format: "ffa4",
      p0: { hand: ["Pot of Greed"], spells: [{ card: "Swords of Revealing Light", pos: "up" }] },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
      p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    },
    steps: [
      activate("Pot of Greed", "p0"),
      activate("Dust Tornado", "p1"),
      // R-FFA-OPP-ONE: declare the opponent before selecting its card.
      pickOpponent("p0", "p1"),
      select({ card: "Swords of Revealing Light" }),
      expectPrompt({ by: "p2", context: "chain" }),
      surrender("p1"),
      // The chain is the same one: the surrender did not pass the window of p2 and did not close the chain.
      expectChain("Pot of Greed", "Dust Tornado"),
      expectPrompt({ by: "p2", context: "chain" }),
      pass("p2"),
      expectEliminated("p1"),
      // The Dust Tornado of p1 is a link of a seat that is out: no effect. The Swords stays.
      expectBoard({ p0: { hand: { count: 2 }, grave: ["Pot of Greed"], spells: ["Swords of Revealing Light"] } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-surrender-with-card-prompt-open",
    title: "FFA4: a seat that gives up while it picks the target of its Dust Tornado loses, and the link has no effect",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "chain", "surrender", "prompt", "ffa4", "card:55144522", "card:60082869"],
    // p1 activates Dust Tornado on the Swords of p0 and has a card prompt open (select the target) when it gives up. The engine
    // answers that prompt for p1. The link must do nothing. p2 holds a set Dust Tornado, so the chain stays open for a window.
    setup: {
      format: "ffa4",
      p0: { hand: ["Pot of Greed"], spells: [{ card: "Swords of Revealing Light", pos: "up" }, { card: "Swords of Revealing Light", pos: "up" }] },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
      p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    },
    steps: [
      activate("Pot of Greed", "p0"),
      activate("Dust Tornado", "p1"),
      // R-FFA-OPP-ONE: declare the opponent before selecting its card.
      pickOpponent("p0", "p1"),
      expectPrompt({ by: "p1", kind: "cards" }),
      surrender("p1"),
      // The activation was not cancelled: the link of p1 is on the chain, and p2 holds the window after it.
      expectChain("Pot of Greed", "Dust Tornado"),
      expectPrompt({ by: "p2", context: "chain" }),
      pass("p2"),
      expectEliminated("p1"),
      // The link of p1 resolved with no effect.
      expectBoard({ p0: { hand: { count: 2 }, grave: ["Pot of Greed"], spells: { count: 2 } } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-surrender-with-zone-prompt-open",
    title: "FFA4: the turn player that gives up while it picks the zone of Heavy Storm loses, and Heavy Storm destroys nothing",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "surrender", "prompt", "ffa4", "card:19613556", "card:72302403"],
    setup: {
      format: "ffa4",
      p0: { hand: ["Heavy Storm"] },
      p1: { spells: [{ card: "Swords of Revealing Light", pos: "up" }] },
    },
    steps: [
      activate("Heavy Storm", "p0"),
      expectPrompt({ by: "p0", kind: "places" }),
      surrender("p0"),
      expectEliminated("p0"),
      expectTurn("p1", 2),
      expectBoard({ p1: { spells: ["Swords of Revealing Light"], grave: { count: 0 } } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-two-surrenders-in-one-chain",
    title: "FFA4: two seats give up while both of their Dust Tornado links are on the chain, and both links have no effect",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "chain", "surrender", "ffa4", "card:55144522", "card:60082869"],
    // Chain: Pot of Greed (p0), Dust Tornado (p1), Dust Tornado (p2). p1 holds a second Dust Tornado, so it has the open window.
    // p2 gives up first (it holds no prompt), then p1 (it holds the window). The two Swords of p0 stay.
    setup: {
      format: "ffa4",
      p0: { hand: ["Pot of Greed"], spells: [0, 1].map(() => ({ card: "Swords of Revealing Light", pos: "up" as const })) },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }, { card: "Dust Tornado", pos: "set" }] },
      p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    },
    steps: [
      activate("Pot of Greed", "p0"),
      activate("Dust Tornado", "p1"),
      // R-FFA-OPP-ONE: declare the opponent before selecting its card.
      pickOpponent("p0", "p1"),
      select({ card: "Swords of Revealing Light", nth: 0 }),
      pass("p1"),
      activate("Dust Tornado", "p2"),
      // R-FFA-OPP-ONE: declare the opponent before selecting its card.
      pickOpponent("p0", "p2"),
      select({ card: "Swords of Revealing Light", nth: 1 }),
      expectChain("Pot of Greed", "Dust Tornado", "Dust Tornado"),
      expectPrompt({ by: "p1", context: "chain" }),
      surrender("p2"),
      surrender("p1"),
      expectEliminated("p1", "p2"),
      expectBoard({ p0: { hand: { count: 2 }, grave: ["Pot of Greed"], spells: { count: 2 } } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-turn-player-surrenders-mid-battle",
    title: "FFA4: the turn player gives up after its attack is declared while p3 holds a chain window: the window stays, the attack is rolled back",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-ATTACK"],
    tags: ["multiplayer", "elimination", "battle", "surrender", "ffa4", "card:15025844", "card:60082869"],
    // The set Dust Tornado of p3 opens optional windows at every turn change (5, 5, 5 and 4 of them): they are declined.
    setup: {
      format: "ffa4",
      p0: { monsters: [ELF], spells: [{ card: "Heavy Storm", pos: "set" }] },
      p1: { monsters: [ELF] },
      p3: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    },
    steps: [
      endTurn("p0"), ...declineWindows("p3", 5),
      endTurn("p1"), ...declineWindows("p3", 5),
      endTurn("p2"), ...declineWindows("p3", 5),
      endTurn("p3"), ...declineWindows("p3", 4),
      expectTurn("p0", 5),
      changePhase("battle", "p0"), ...declineWindows("p3", 2),
      attack(ELF, { card: ELF, owner: "p1" }, "p0"),
      expectPrompt({ by: "p3", context: "chain" }),
      surrender("p0"),
      // The window of p3 is still there: the loss of the turn player does not close it.
      expectPrompt({ by: "p3", context: "chain" }),
      ...declineWindows("p3", 2),
      expectEliminated("p0"),
      expectTurn("p1", 6),
      // No battle took place: the Elf of p1 is alive and nobody lost LP.
      expectBoard({ p1: { monsters: [ELF], lp: 8000 }, p2: { lp: 8000 }, p3: { lp: 8000 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-seat-out-before-first-turn-no-attack-until-all-living-had-a-turn",
    title: "FFA3: a seat that is out before its first turn does not delay the first attack: p0 attacks on turn 3, not before",
    source: `${SOURCE} [R-FFA-NO-ATTACK]`,
    rules: ["R-FFA-NO-ATTACK", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "battle", "surrender", "ffa3", "card:15025844"],
    // The no-attack window ends when every LIVING duelist has had a turn. p1 gives up on turn 1 and never has a turn, so the
    // window ends after the turn of p2 (turn 2), and p0 may attack on turn 3.
    setup: { format: "ffa3", p0: { monsters: [ELF] }, p1: { monsters: [ELF] } },
    steps: [
      surrender("p1"),
      expectPrompt({ by: "p0", notOffers: ["to_bp"] }),
      endTurn("p0"), expectTurn("p2", 2), expectPrompt({ by: "p2", notOffers: ["to_bp"] }),
      endTurn("p2"), expectTurn("p0", 3), expectPrompt({ by: "p0", offers: ["to_bp"] }),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      expectBoard({ p2: { lp: 8000 - ELF_ATK }, p0: { lp: 8000 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-seat-out-before-first-turn-no-attack-until-all-living-had-a-turn",
    title: "FFA4: a seat that is out before its first turn does not delay the first attack: p0 attacks on turn 4, not before",
    source: `${SOURCE} [R-FFA-NO-ATTACK]`,
    rules: ["R-FFA-NO-ATTACK", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "battle", "surrender", "ffa4", "card:15025844"],
    setup: { format: "ffa4", p0: { monsters: [ELF] } },
    steps: [
      surrender("p1"),
      expectPrompt({ by: "p0", notOffers: ["to_bp"] }),
      endTurn("p0"), expectTurn("p2", 2), expectPrompt({ by: "p2", notOffers: ["to_bp"] }),
      endTurn("p2"), expectTurn("p3", 3), expectPrompt({ by: "p3", notOffers: ["to_bp"] }),
      endTurn("p3"), expectTurn("p0", 4), expectPrompt({ by: "p0", offers: ["to_bp"] }),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      expectPickSeats(["p2", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      expectBoard({ p3: { lp: 8000 - ELF_ATK }, p2: { lp: 8000 }, p1: { lp: 8000 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-direct-attack-mixed-fields",
    title: "FFA4: with one opponent that has a monster, the direct attack is offered on the two without a monster only, and the monster is attacked normally",
    source: `${SOURCE} [R-FFA-ATTACK]`,
    rules: ["R-FFA-ATTACK"],
    tags: ["multiplayer", "battle", "direct-attack", "ffa4"],
    // p1 has a monster, p2 and p3 have none. The core asks "Attack directly?" first, then which opponent.
    setup: { format: "ffa4", p0: { monsters: [ELF, ELF] }, p1: { monsters: [ELF] } },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      expectPrompt({ by: "p0", title: "Attack directly" }),
      yes("p0"),
      expectPickSeats(["p2", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      expectBoard({ p3: { lp: 8000 - ELF_ATK }, p2: { lp: 8000 }, p1: { lp: 8000, monsters: [ELF] } }),
      // The second Elf answers "no" to the direct question and attacks the Elf of p1 (equal ATK: both are destroyed).
      attack(ELF, { card: ELF, owner: "p1" }, "p0"),
      expectBoard({ p1: { monsters: { count: 0 }, lp: 8000 }, p0: { monsters: [ELF] }, p3: { lp: 8000 - ELF_ATK } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-turn-player-and-one-opponent-out-in-one-effect",
    title: "FFA4: Destruction Ring takes the turn player and p1 to 0 LP in one effect: both are out, and the turn goes to p2, then p3, then p2",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-ORDER"],
    tags: ["multiplayer", "elimination", "simultaneous", "ffa4", "card:15025844", "card:21219755"],
    setup: { format: "ffa4", p0: { lp: 1000, monsters: [ELF], spells: [DESTRUCTION_RING] }, p1: { lp: 1000 } },
    steps: [
      activate("Destruction Ring", "p0"),
      expectEliminated("p0", "p1"),
      expectBoard({ p0: { lp: 0, ...VIEW_EMPTY }, p1: { lp: 0, ...VIEW_EMPTY }, p2: { lp: 7000 }, p3: { lp: 7000 } }),
      // The turn of p0 is cut short: the next living seat is p2 (turn 2), then p3, then p2 again.
      expectTurn("p2", 2),
      endTurn("p2"),
      expectTurn("p3", 3),
      endTurn("p3"),
      expectTurn("p2", 4),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-three-out-in-one-effect-last-wins",
    title: "FFA4: Destruction Ring takes p0, p1 and p3 to 0 LP in one effect: p2 is the last seat left and wins",
    source: `${SOURCE} [R-FFA-WINNER]`,
    rules: ["R-FFA-WINNER", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "simultaneous", "ffa4", "card:15025844", "card:21219755"],
    setup: { format: "ffa4", p0: { lp: 1000, monsters: [ELF], spells: [DESTRUCTION_RING] }, p1: { lp: 1000 }, p3: { lp: 500 } },
    steps: [
      activate("Destruction Ring", "p0"),
      expectEliminated("p0", "p1", "p3"),
      expectResult({ seat: "p2" }),
      expectBoard({ p0: { lp: 0 }, p1: { lp: 0 }, p2: { lp: 7000 }, p3: { lp: 0 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-all-four-out-in-one-effect-draw",
    title: "FFA4: Destruction Ring takes all four seats to 0 LP in one effect: nobody is left, the duel is a draw (no winner)",
    source: `${SOURCE} [R-FFA-WINNER]`,
    rules: ["R-FFA-WINNER", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "simultaneous", "draw", "ffa4", "card:15025844", "card:21219755"],
    setup: {
      format: "ffa4",
      p0: { lp: 1000, monsters: [ELF], spells: [DESTRUCTION_RING] }, p1: { lp: 1000 }, p2: { lp: 1000 }, p3: { lp: 1000 },
    },
    steps: [
      activate("Destruction Ring", "p0"),
      expectEliminated("p0", "p1", "p2", "p3"),
      expectResult(null),
      expectBoard({ p0: { lp: 0 }, p1: { lp: 0 }, p2: { lp: 0 }, p3: { lp: 0 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-last-two-out-in-one-effect-draw",
    title: "FFA4: p2 and p3 are out by two Hinotama, then Destruction Ring takes the last two seats (p0 and p1) to 0 LP together: a draw",
    source: `${SOURCE} [R-FFA-WINNER]`,
    rules: ["R-FFA-WINNER", "R-FFA-ELIMINATION", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "elimination", "simultaneous", "draw", "ffa4", "card:15025844", "card:21219755", "card:46130346"],
    setup: {
      format: "ffa4",
      p0: { lp: 1000, monsters: [ELF], spells: [DESTRUCTION_RING], hand: ["Hinotama", "Hinotama"] }, p1: { lp: 1000 }, p2: { lp: 500 }, p3: { lp: 500 },
    },
    steps: [
      activate("Hinotama", "p0"),
      expectPickSeats(["p1", "p2", "p3"], "p0"),
      pickOpponent("p2", "p0"),
      pass("p0"), pass("p0"),
      activate("Hinotama", "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      pass("p0"), pass("p0"),
      expectEliminated("p2", "p3"),
      expectBoard({ p0: { lp: 1000 }, p1: { lp: 1000 } }),
      activate("Destruction Ring", "p0"),
      expectEliminated("p0", "p1", "p2", "p3"),
      expectResult(null),
      expectBoard({ p0: { lp: 0 }, p1: { lp: 0 }, p2: { lp: 0 }, p3: { lp: 0 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-turn-player-out-mid-round-turn-passes-to-next-living",
    title: "FFA4: the turn player p2 and p3 are out by a flip effect in the turn of p2: the turn goes to p0, then p1, then p0",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-ORDER"],
    tags: ["multiplayer", "elimination", "turn-order", "ffa4", "card:6783559"],
    setup: { format: "ffa4", p2: { lp: 1000, monsters: [{ card: "Self-Destruct Ant", pos: "set" }] }, p3: { lp: 1000 } },
    steps: [
      endTurn("p0"),
      endTurn("p1"),
      expectTurn("p2", 3),
      changePosition("Self-Destruct Ant", "p2"),
      expectEliminated("p2", "p3"),
      expectBoard({ p0: { lp: 7000 }, p1: { lp: 7000 }, p2: { lp: 0, ...VIEW_EMPTY }, p3: { lp: 0, ...VIEW_EMPTY } }),
      // The turn of p2 is cut short. The next living seat clockwise is p0 (turn 4), then p1, then p0 again.
      expectTurn("p0", 4),
      endTurn("p0"),
      expectTurn("p1", 5),
      endTurn("p1"),
      expectTurn("p0", 6),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-two-neighbours-out-turn-skips-both",
    title: "FFA4: p1 and p2 (neighbours in the turn order) give up in the turn of p0: the turn goes p3, p0, p3 and never to a seat that is out",
    source: `${SOURCE} [R-FFA-ORDER]`,
    rules: ["R-FFA-ORDER", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "turn-order", "surrender", "ffa4"],
    setup: { format: "ffa4" },
    steps: [
      surrender("p1"),
      surrender("p2"),
      // With no chain open, the loss of a seat that gave up lands at the next check of the core: the turn player ends its turn.
      endTurn("p0"),
      expectTurn("p3", 2),
      expectEliminated("p1", "p2"),
      expectBoard({ p0: { lp: 8000 }, p1: { lp: 8000, ...VIEW_EMPTY }, p2: { lp: 8000, ...VIEW_EMPTY }, p3: { lp: 8000 } }),
      endTurn("p3"),
      expectTurn("p0", 3),
      endTurn("p0"),
      expectTurn("p3", 4),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-three-surrenders-in-a-row-last-wins",
    title: "FFA4: p3, p1 and p2 give up one after the other; p0 wins when it ends its turn and the three losses take effect",
    source: `${SOURCE} [R-FFA-WINNER]`,
    rules: ["R-FFA-WINNER", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "elimination", "surrender", "ffa4"],
    setup: { format: "ffa4" },
    steps: [
      surrender("p3"),
      surrender("p1"),
      surrender("p2"),
      // The three losses land at the next check of the core: the turn player ends its turn.
      endTurn("p0"),
      expectEliminated("p1", "p2", "p3"),
      expectResult({ seat: "p0" }),
      // A seat that gives up keeps its LP: it loses by the surrender, not at 0 LP.
      expectBoard({ p0: { lp: 8000 }, p1: { lp: 8000 }, p2: { lp: 8000 }, p3: { lp: 8000 } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-simultaneous-triggers-turn-player-first",
    title: "FFA4: Dark Hole sends the Sangan of p0 (turn player) and the Witch of the Black Forest of p2 to the Graveyard together: the trigger of p0 goes on the chain first, so the Witch of p2 resolves first",
    source: `${SOURCE} [R-FFA-TRIGGERS]`,
    rules: ["R-FFA-TRIGGERS"],
    tags: ["multiplayer", "triggers", "chain", "ffa4", "card:26202165", "card:78010363", "card:53129443"],
    // Mandatory triggers of different duelists in one event: the turn player first, then clockwise. A chain resolves in reverse, so
    // the LAST trigger on the chain resolves first. Under the wrong order (p2 before p0) Sangan would resolve first.
    setup: {
      format: "ffa4",
      p0: { hand: ["Dark Hole"], monsters: ["Sangan"], deck: [ELF, "Giant Rat"] },
      p2: { monsters: ["Witch of the Black Forest"], deck: ["Silver Fang"] },
    },
    steps: [
      activate("Dark Hole", "p0"),
      // The Witch finds one legal target only (Silver Fang, DEF 800: the filler Deck holds Mystical Elf, DEF 2000), so it asks for no pick.
      select("Giant Rat"),
      // Dark Hole resolves first. The triggers then form a new chain of their own.
      expectResolved("Dark Hole", "Witch of the Black Forest", "Sangan"),
      expectBoard({
        p0: { lp: 8000, monsters: [], spells: [], banished: [], hand: ["Giant Rat"], grave: ["Dark Hole", "Sangan"] },
        p1: { lp: 8000, monsters: [], spells: [], hand: [], banished: [], grave: [] },
        p2: { lp: 8000, monsters: [], spells: [], banished: [], hand: ["Silver Fang"], grave: ["Witch of the Black Forest"] },
        p3: { lp: 8000, monsters: [], spells: [], hand: [], banished: [], grave: [] },
      }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-simultaneous-triggers-clockwise-from-turn-player",
    title: "FFA4: in the turn of p1, Dark Hole sends the Sangan of p0 and the Witch of the Black Forest of p2 to the Graveyard together: the order is clockwise from the turn player (p2, then p0), so Sangan of p0 resolves first",
    source: `${SOURCE} [R-FFA-TRIGGERS]`,
    rules: ["R-FFA-TRIGGERS"],
    tags: ["multiplayer", "triggers", "chain", "ffa4", "card:26202165", "card:78010363", "card:53129443"],
    // The turn player is p1. Clockwise from p1 the seats are p2, p3, p0. So the Witch of p2 goes on the chain first and the Sangan of
    // p0 second, and Sangan resolves first. A plain seat order from p0 would put Sangan first on the chain.
    setup: {
      format: "ffa4",
      p0: { monsters: ["Sangan"], deck: [ELF, "Giant Rat"] },
      p1: { hand: ["Dark Hole"] },
      p2: { monsters: ["Witch of the Black Forest"], deck: ["Silver Fang"] },
    },
    steps: [
      endTurn("p0"),
      expectTurn("p1", 2),
      activate("Dark Hole", "p1"),
      select("Giant Rat"),
      expectResolved("Dark Hole", "Sangan", "Witch of the Black Forest"),
      expectBoard({
        p0: { lp: 8000, monsters: [], spells: [], banished: [], hand: ["Giant Rat"], grave: ["Sangan"] },
        p1: { lp: 8000, monsters: [], spells: [], hand: ["Mystical Elf"], banished: [], grave: ["Dark Hole"] },
        p2: { lp: 8000, monsters: [], spells: [], banished: [], hand: ["Silver Fang"], grave: ["Witch of the Black Forest"] },
        p3: { lp: 8000, monsters: [], spells: [], hand: [], banished: [], grave: [] },
      }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-negate-spell-from-far-seat",
    title: "FFA4: the set Solemn Judgment of p3 (the last seat in the chain order) negates the activation of Raigeki of p0: p1 and p2 keep their monsters, Raigeki goes to the Graveyard and p3 pays half of its LP",
    source: `${SOURCE} [R-FFA-NEGATE]`,
    rules: ["R-FFA-NEGATE"],
    tags: ["multiplayer", "negate", "chain", "ffa4", "card:41420027", "card:12580477"],
    setup: {
      format: "ffa4",
      p0: { hand: ["Raigeki"] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: ["Axe Raider"] },
      p3: { monsters: ["Silver Fang"], spells: [{ card: "Solemn Judgment", pos: "set" }] },
    },
    steps: [
      activate("Raigeki", "p0"),
      // R-FFA-OPP-ONE: declare the opponent before the response window.
      pickOpponent("p1", "p0"),
      expectPrompt({ by: "p3", context: "chain" }),
      activate("Solemn Judgment", "p3"),
      expectBoard({
        p0: { lp: 8000, monsters: [], spells: [], hand: [], banished: [], grave: ["Raigeki"] },
        p1: { lp: 8000, monsters: ["Battle Ox"], spells: [], hand: [], banished: [], grave: [] },
        p2: { lp: 8000, monsters: ["Axe Raider"], spells: [], hand: [], banished: [], grave: [] },
        p3: { lp: 4000, monsters: ["Silver Fang"], spells: [], hand: [], banished: [], grave: ["Solemn Judgment"] },
      }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa4-negate-effect-from-far-seat",
    title: "FFA4: Ash Blossom & Joyous Spring in the hand of p3 negates the search of Reinforcement of the Army that p1 activates (not its neighbour): p1 adds no card, p3 discards Ash Blossom",
    source: `${SOURCE} [R-FFA-NEGATE]`,
    rules: ["R-FFA-NEGATE"],
    tags: ["multiplayer", "negate", "chain", "ffa4", "card:14558127", "card:32807846"],
    // p0 passes the turn to p1. p1 searches. p2 has no card to answer with. p3, three seats from p0, holds Ash Blossom.
    setup: {
      format: "ffa4",
      // p1 draws 1 card in its turn: the Deck holds 2 Axe Raider (a Warrior, the Ox is not), so one is drawn and one is left as the target of the search.
      p1: { hand: ["Reinforcement of the Army"], deck: ["Axe Raider", "Axe Raider"] },
      p3: { hand: ["Ash Blossom & Joyous Spring"] },
    },
    steps: [
      endTurn("p0"),
      expectTurn("p1", 2),
      activate("Reinforcement of the Army", "p1"),
      expectPrompt({ by: "p3", context: "chain" }),
      activate("Ash Blossom & Joyous Spring", "p3"),
      expectBoard({
        p0: { lp: 8000, monsters: [], spells: [], hand: [], banished: [], grave: [] },
        p1: { lp: 8000, monsters: [], spells: [], hand: ["Axe Raider"], banished: [], grave: ["Reinforcement of the Army"] },
        p2: { lp: 8000, monsters: [], spells: [], hand: [], banished: [], grave: [] },
        p3: { lp: 8000, monsters: [], spells: [], hand: [], banished: [], grave: ["Ash Blossom & Joyous Spring"] },
      }),
    ],
  }),
];
