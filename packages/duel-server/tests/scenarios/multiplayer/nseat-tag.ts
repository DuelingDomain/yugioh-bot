// Tag Duel end states on a real engine (NSEAT_LIVE=1, see tests/scenarios/multiplayer/nseat-live.test.ts). Plain data, also read by
// scripts/rule-coverage.ts. Tag seats: p0 and p2 are team 0, p1 and p3 are team 1. Turn order is p0, p1, p2, p3 (1A, 2A, 1B, 2B).
// Every scenario asserts the FINAL state after an action (LP, who is out, who wins), not only the first prompt.

import {
  activate, attack, changePhase, choose, defineScenario, endTurn, expectBoard, expectEliminated, expectLp, expectPickSeats,
  expectResult, expectTurn, normalSummon, pickOpponent, select, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, ELF_ATK, SOURCE } from "./nseat-scenarios.js";

const passTurns = (...seats: Array<"p0" | "p1" | "p2" | "p3">): Step[] => seats.map((seat) => endTurn(seat));

export const TAG_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "nseat-tag-partners-lose-together",
    title: "Tag: the team LP reaches 0 by battle damage, both partners lose and the other team wins",
    source: `${SOURCE} [R-TAG-LOSS]`,
    rules: ["R-TAG-LOSS"],
    tags: ["multiplayer", "elimination", "lp", "tag"],
    setup: { format: "tag", p3: { monsters: [ELF] }, p0: { lp: ELF_ATK } },
    steps: [
      expectLp({ team: 0 }, ELF_ATK),
      expectLp({ team: 1 }, 16000),
      ...passTurns("p0", "p1", "p2"),
      expectTurn("p3", 4),
      changePhase("battle", "p3"),
      attack(ELF, "direct", "p3"),
      // The hit goes to p2, not to p0: the team LP is one total, so the whole team is out.
      pickOpponent("p2", "p3"),
      expectLp({ team: 0 }, 0),
      expectLp({ seat: "p0" }, 0),
      expectLp({ seat: "p2" }, 0),
      expectEliminated("p0", "p2"),
      expectLp({ team: 1 }, 16000),
      expectResult({ team: 1 }),
    ],
  }),
  defineScenario({
    id: "nseat-tag-deck-out-loses-team",
    title: "Tag: a duelist who must draw from an empty Deck loses with the whole team, the other team wins",
    source: `${SOURCE} [R-TAG-LOSS]`,
    rules: ["R-TAG-LOSS"],
    tags: ["multiplayer", "elimination", "draw", "tag"],
    setup: { format: "tag", deckSize: 1 },
    steps: [
      // Each Deck has one card. p0 skips the draw of turn 1, so p0 draws on turn 5 and p1 is the first duelist to find an empty Deck.
      ...passTurns("p0", "p1", "p2", "p3", "p0"),
      expectEliminated("p1", "p3"),
      expectBoard({ p0: { deckCount: 0 }, p1: { deckCount: 0 } }),
      expectResult({ team: 0 }),
    ],
  }),
  defineScenario({
    id: "nseat-tag-partner-is-never-an-attack-target",
    title: "Tag: the direct-attack pick of team 1 offers p0 and p2 only (not the partner p1), and the hit lands on the picked team",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "battle", "direct-attack", "tag"],
    setup: { format: "tag", p3: { monsters: [ELF] } },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p3"),
      choose("attack:0", "p3"),
      expectPickSeats(["p0", "p2"], "p3"),
      pickOpponent("p2", "p3"),
      expectLp({ team: 0 }, 16000 - ELF_ATK),
      expectLp({ team: 1 }, 16000),
    ],
  }),
  defineScenario({
    id: "nseat-tag-partner-is-never-an-attack-target-team-0",
    title: "Tag: the direct-attack pick of team 0 offers p1 and p3 only (not the partner p2)",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "battle", "direct-attack", "tag"],
    setup: { format: "tag", p0: { hand: [ELF] } },
    steps: [
      ...passTurns("p0", "p1", "p2", "p3"),
      normalSummon(ELF, "p0"),
      changePhase("battle", "p0"),
      choose("attack:0", "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      expectLp({ team: 1 }, 16000 - ELF_ATK),
      expectLp({ team: 0 }, 16000),
    ],
  }),
  defineScenario({
    id: "nseat-tag-partner-attack-target-list",
    title: "Tag: with monsters on every field the attack targets are the opposing team's monsters, never the partner's",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "battle", "tag"],
    setup: { format: "tag", p0: { monsters: [ELF] }, p1: { monsters: [ELF] }, p2: { monsters: [ELF] }, p3: { monsters: [ELF] } },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p3"),
      choose("attack:0", "p3"),
      expectPickSeats(["p0", "p2"], "p3"),
      select({ card: ELF, owner: "p0" }),
      // Equal ATK: both Elves are destroyed. The partner's Elf (p1) and the other opponent's Elf (p2) are untouched.
      expectBoard({ p0: { monsters: { count: 0 } }, p3: { monsters: { count: 0 } }, p1: { monsters: [ELF] }, p2: { monsters: [ELF] } }),
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 16000),
    ],
  }),
  defineScenario({
    id: "nseat-tag-burn-spares-partner",
    title: "Tag: a burn card hits the opposing team's LP and leaves the user's team (the partner) alone",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "lp", "tag", "card:46130346"],
    setup: { format: "tag", p1: { hand: ["Hinotama"] } },
    steps: [
      endTurn("p0"),
      activate("Hinotama", "p1"),
      expectLp({ team: 0 }, 16000 - 500),
      expectLp({ seat: "p0" }, 16000 - 500),
      expectLp({ seat: "p2" }, 16000 - 500),
      expectLp({ team: 1 }, 16000),
      expectLp({ seat: "p3" }, 16000),
    ],
  }),
  defineScenario({
    id: "nseat-tag-deck-and-turn-order",
    title: "Tag: the four duelists take turns in seat order 1A, 2A, 1B, 2B and each draws from their own Deck",
    source: `${SOURCE} [R-TAG-ORDER]`,
    rules: ["R-TAG-ORDER"],
    tags: ["multiplayer", "turn-order", "draw", "tag"],
    setup: {
      format: "tag",
      p0: { deck: ["Raigeki"] },
      p1: { deck: ["Dark Hole"] },
      p2: { deck: ["Sangan"] },
      p3: { deck: ["Giant Rat"] },
    },
    steps: [
      expectTurn("p0", 1),
      expectBoard({ p0: { deckCount: 20, hand: { count: 0 } } }),
      endTurn("p0"),
      expectTurn("p1", 2),
      expectBoard({ p1: { hand: ["Dark Hole"], deckCount: 19 }, p2: { hand: { count: 0 }, deckCount: 20 } }),
      endTurn("p1"),
      expectTurn("p2", 3),
      expectBoard({ p2: { hand: ["Sangan"], deckCount: 19 }, p3: { hand: { count: 0 }, deckCount: 20 } }),
      endTurn("p2"),
      expectTurn("p3", 4),
      expectBoard({ p3: { hand: ["Giant Rat"], deckCount: 19 }, p0: { hand: { count: 0 }, deckCount: 20 } }),
      endTurn("p3"),
      // The first duelist draws for the first time on turn 5.
      expectTurn("p0", 5),
      expectBoard({ p0: { hand: ["Raigeki"], deckCount: 19 } }),
    ],
  }),
];
