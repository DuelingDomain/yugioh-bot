// FFA3 and FFA4 end states on a real engine (NSEAT_LIVE=1, see nseat-live.test.ts). Plain data, also read by
// scripts/rule-coverage.ts. Natural eliminations only (battle damage, effect damage, drawing from an empty Deck): no
// Debug.EliminateDuelist. Real cards: Hinotama (500 damage, opponent pick), Mind Crush (opponent pick, hand), Heavy Storm and
// Dust Tornado (the chain). Every scenario asserts a FINAL state after an action.

import {
  activate, announce, attack, changePhase, defineScenario, endTurn, expectBoard, expectChain, expectEliminated, expectLp, expectNotOffered,
  expectPickSeats, expectPrompt, expectResolved, expectResponseOrder, expectResult, expectTurn, pass, pickOpponent,
  select, surrender, yes, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, ELF_ATK, SOURCE } from "./nseat-scenarios.js";

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
      expectBoard({ p0: VIEW_EMPTY, p1: { deckCount: 0 }, p2: { deckCount: 1 } }),
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
    title: "FFA4: after p2 adds a link the turn player p0 answers first, then p1 and p3, and the chain resolves in reverse",
    source: `${SOURCE} [R-FFA-CHAIN]`,
    rules: ["R-FFA-CHAIN"],
    tags: ["multiplayer", "chain", "ffa4", "card:19613556", "card:60082869"],
    // Every seat holds a Dust Tornado, so every window is a real prompt. Under the ADR order the windows are p1, p2 (the turn
    // player p0 added Heavy Storm, so the next seat goes first), then after the link of p2: p0 (turn player first), p1, p3. A plain
    // "next seat after the one who added the link" order would give p3, p0, p1 there.
    setup: {
      format: "ffa4",
      p0: {
        hand: ["Heavy Storm"],
        spells: [{ card: "Dust Tornado", pos: "set" }, ...[0, 1].map(() => ({ card: "Swords of Revealing Light", pos: "up" as const }))],
      },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
      p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
      p3: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    },
    steps: [
      activate("Heavy Storm", "p0"),
      pass("p1"),
      activate("Dust Tornado", "p2"),
      select({ card: "Swords of Revealing Light", nth: 0 }),
      expectChain("Heavy Storm", "Dust Tornado"),
      pass("p0"),
      pass("p1"),
      pass("p3"),
      expectResponseOrder("p1", "p2", "p0", "p1", "p3"),
      expectResolved("Dust Tornado", "Heavy Storm"),
      // Dust Tornado of p2 destroyed one Swords. Heavy Storm then destroyed the other Spells and Traps, the set ones too.
      expectBoard({
        p0: { spells: { count: 0 }, grave: { include: ["Heavy Storm", "Swords of Revealing Light", "Dust Tornado"] } },
        p1: { spells: { count: 0 }, grave: ["Dust Tornado"] },
        p2: { spells: { count: 0 }, grave: ["Dust Tornado"] },
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
    // On turn 2 p1 (500 LP, one monster) plays Heavy Storm. p0 answers with Just Desserts (500 damage per monster) and picks p1,
    // so p1 is eliminated while its link is still on the chain. That link must do nothing: the Swords of p2 stays.
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
      expectPickSeats(["p1", "p2", "p3"], "p0"),
      pickOpponent("p1", "p0"),
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
      pickOpponent("p1", "p0"),
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
      pickOpponent("p1", "p0"),
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
      select({ card: "Swords of Revealing Light" }),
      expectPrompt({ by: "p2", context: "chain" }),
      surrender("p1"),
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
    // answers that prompt for p1. The link must do nothing.
    setup: {
      format: "ffa4",
      p0: { hand: ["Pot of Greed"], spells: [{ card: "Swords of Revealing Light", pos: "up" }, { card: "Swords of Revealing Light", pos: "up" }] },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    },
    steps: [
      activate("Pot of Greed", "p0"),
      activate("Dust Tornado", "p1"),
      expectPrompt({ by: "p1", kind: "cards" }),
      surrender("p1"),
      expectEliminated("p1"),
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
      select({ card: "Swords of Revealing Light", nth: 0 }),
      pass("p1"),
      activate("Dust Tornado", "p2"),
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
];
