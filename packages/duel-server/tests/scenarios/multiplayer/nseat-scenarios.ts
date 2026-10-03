// Layer 1 scenarios for N-seat tables (FFA3, FFA4, Tag). Plain data: no Vitest import, so that
// scripts/rule-coverage.ts can load this file. tests/scenarios/multiplayer/nseat.test.ts runs them on a live core.
//
// `rules` is the rule-coverage marker. A scenario counts as outcome coverage for those ADR-0002 rule ids only if it
// runs on a real engine and asserts an outcome after at least one action (see `outcomeAsserts` in
// scripts/rule-coverage.ts). A check of the first prompt alone does not count.

import {
  attack, changePhase, endTurn, expectBoard, expectEliminated, expectLp, expectNoPrompt, expectPrompt,
  expectResult, expectTurn, pickOpponent, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";

export const ELF = "Mystical Elf"; // 800 ATK vanilla, also the Deck filler
export const ELF_ATK = 800;
export const SOURCE = "docs/adr/0002-multiplayer-duel-rules.md";

const elfAt = (lp?: number) => ({ monsters: [ELF], ...(lp != null ? { lp } : {}) });
const passTurns = (...seats: Array<"p0" | "p1" | "p2" | "p3">): Step[] => seats.map((seat) => endTurn(seat));

export const NSEAT_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "nseat-ffa4-turn-order",
    title: "FFA4: turns go clockwise p0, p1, p2, p3, p0",
    source: `${SOURCE} [R-FFA-ORDER]`,
    rules: ["R-FFA-ORDER"],
    tags: ["multiplayer", "turn-order", "ffa4"],
    setup: { format: "ffa4" },
    steps: [
      expectPrompt({ by: "p0" }),
      endTurn("p0"), expectPrompt({ by: "p1" }),
      endTurn("p1"), expectPrompt({ by: "p2" }),
      endTurn("p2"), expectPrompt({ by: "p3" }),
      endTurn("p3"), expectPrompt({ by: "p0" }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-every-first-draw",
    title: "Standard MR5 FFA3: only the turn-1 duelist skips the first draw",
    source: `${SOURCE} [R-FFA-ORDER] [R-FFA-FIRST-DRAW]`,
    rules: ["R-FFA-ORDER", "R-FFA-FIRST-DRAW"],
    tags: ["multiplayer", "draw", "ffa3"],
    setup: { format: "ffa3", deckSize: 20 },
    steps: [
      expectBoard({ p0: { deckCount: 20, hand: { count: 0 } }, p1: { deckCount: 20 }, p2: { deckCount: 20 } }),
      endTurn("p0"),
      expectBoard({ p0: { deckCount: 20 }, p1: { deckCount: 19, hand: { count: 1 } }, p2: { deckCount: 20 } }),
      endTurn("p1"),
      expectBoard({ p1: { deckCount: 19 }, p2: { deckCount: 19, hand: { count: 1 } } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-no-attack-first-round",
    title: "FFA3: no Battle Phase until every duelist had one turn, then p0 may attack on turn 4",
    source: `${SOURCE} [R-FFA-NO-ATTACK]`,
    rules: ["R-FFA-NO-ATTACK"],
    tags: ["multiplayer", "battle", "ffa3"],
    setup: { format: "ffa3", p0: elfAt(), p1: elfAt(), p2: elfAt() },
    steps: [
      expectPrompt({ by: "p0", notOffers: ["to_bp"] }),
      endTurn("p0"), expectPrompt({ by: "p1", notOffers: ["to_bp"] }),
      endTurn("p1"), expectPrompt({ by: "p2", notOffers: ["to_bp"] }),
      endTurn("p2"), expectPrompt({ by: "p0", offers: ["to_bp"] }),
    ],
  }),
  defineScenario({
    id: "nseat-tag-first-battle-turn-4",
    title: "Tag: the first three duelists cannot attack, the first Battle Phase is turn 4 (p3)",
    source: `${SOURCE} [R-TAG-ORDER]`,
    rules: ["R-TAG-ORDER"],
    tags: ["multiplayer", "battle", "tag"],
    setup: { format: "tag", p0: elfAt(), p1: elfAt(), p2: elfAt(), p3: elfAt() },
    steps: [
      expectPrompt({ by: "p0", notOffers: ["to_bp"] }),
      // The first duelist does not draw on turn 1.
      expectBoard({ p0: { hand: { count: 0 }, deckCount: 20 } }),
      endTurn("p0"), expectPrompt({ by: "p1", notOffers: ["to_bp"] }),
      expectBoard({ p1: { hand: { count: 1 }, deckCount: 19 } }),
      endTurn("p1"), expectPrompt({ by: "p2", notOffers: ["to_bp"] }),
      endTurn("p2"), expectPrompt({ by: "p3", offers: ["to_bp"] }),
      // p3 attacks on turn 4. p3 and p0 have equal ATK, so both Elves are destroyed; the other two Elves stay.
      expectTurn("p3", 4),
      changePhase("battle", "p3"),
      attack(ELF, { card: ELF, owner: "p0" }, "p3"),
      expectBoard({
        p0: { monsters: { count: 0 }, grave: [ELF] },
        p3: { monsters: { count: 0 }, grave: [ELF] },
        p1: { monsters: [ELF] },
        p2: { monsters: [ELF] },
      }),
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 16000),
    ],
  }),
  defineScenario({
    id: "nseat-tag-team-lp",
    title: "Tag: a direct attack lowers the LP of the whole team, both partners show it",
    source: `${SOURCE} [R-TAG-LP]`,
    rules: ["R-TAG-LP"],
    tags: ["multiplayer", "lp", "tag"],
    setup: { format: "tag", p3: elfAt() },
    steps: [
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 16000),
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p3"),
      attack(ELF, "direct", "p3"),
      pickOpponent("p0", "p3"),
      expectLp({ team: 0 }, 16000 - ELF_ATK),
      expectLp({ seat: "p2" }, 16000 - ELF_ATK),
      expectLp({ team: 1 }, 16000),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-direct-attack-pick",
    title: "FFA3: a direct attack with two open opponents asks which one, and only that one loses LP",
    source: `${SOURCE} [R-FFA-ATTACK]`,
    rules: ["R-FFA-ATTACK", "R-FFA-LP"],
    tags: ["multiplayer", "battle", "direct-attack", "ffa3"],
    setup: { format: "ffa3", p0: elfAt() },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p2", "p0"),
      expectLp({ seat: "p2" }, 8000 - ELF_ATK),
      expectLp({ seat: "p1" }, 8000),
      expectLp({ seat: "p0" }, 8000),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-elimination-and-win",
    title: "FFA3: a duelist at 0 LP is eliminated and the duel goes on, the last one standing wins",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-WINNER"],
    tags: ["multiplayer", "elimination", "ffa3"],
    setup: {
      format: "ffa3",
      p0: { monsters: [ELF, ELF] },
      p1: { lp: ELF_ATK, hand: [ELF], spells: [{ card: "Dark Hole", pos: "set" }], grave: ["Raigeki"] },
      p2: { lp: ELF_ATK },
    },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p1", "p0"),
      expectEliminated("p1"),
      expectLp({ seat: "p1" }, 0),
      // The view of p1 shows an empty seat (the view does not read the core for an eliminated seat), and p0 keeps its monsters.
      // That the core really releases the cards of an eliminated seat is proven in nseat-ffa.ts (Swords, Change of Heart, chain link).
      expectBoard({ p1: { hand: { count: 0 }, spells: { count: 0 }, grave: { count: 0 } }, p0: { monsters: { count: 2 } } }),
      // p1 is out, so p2 is the only opponent left: the core offers no pick, and the hit ends the duel.
      attack(ELF, "direct", "p0"),
      expectNoPrompt(),
      expectEliminated("p1", "p2"),
      expectResult({ seat: "p0" }),
    ],
  }),
];
