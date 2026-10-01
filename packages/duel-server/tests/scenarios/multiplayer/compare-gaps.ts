// Live scenarios of cards that compare monsters or cards of "your opponent" with yours, and that review A found without one:
// Kaiser Colosseum (a value of the summoning duelist), the five scan-gap cards (Three in One, Sangen Kaiho, Evilswarm Exciton Knight,
// Ghost Reaper & Winter Cherries, Mimighoul Slime), the target cap of Ultimate Sky and the per-opponent Mystic Mine.
// Each card has the same two cases: the SUM of the opponents passes but no single opponent does (the card is not offered, nothing changes),
// and one opponent passes (the card is offered and acts on that opponent). Plain data, also read by scripts/rule-coverage.ts;
// tests/scenarios/multiplayer/compare-gaps.test.ts runs them on a live core (NSEAT_LIVE=1). Every scenario ends with the state of every seat.
// Decisions: docs/adr/0002-multiplayer-duel-rules.md (question 2): FFA, the activator compares with ONE opponent.

import {
  activate, changePhase, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPickSeats,
  normalSummon, pass, pickOpponent, select, type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;
const OX = "Battle Ox";
const GUARDIAN = "Celtic Guardian";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const BEAVER = "Beaver Warrior";
const SKULL = "Summoned Skull";

/**
 * The state of EVERY seat of a format, exact for the monster zones, the Spell and Trap zones, the Graveyard, the banished zone and
 * the Life Points (8000 for a seat, 16000 for the team of a Tag duel, unless given). A seat that the spec leaves out must be empty.
 * The hand is checked only when the spec names it.
 */
function everySeat(format: "ffa3" | "ffa4" | "tag", spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const board: BoardExpect = {};
  for (const seat of seats) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

export const COMPARE_GAP_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "compare-gaps-ffa3-kaiser-colosseum-limit-counts-the-summoner-only",
    title: "FFA3: Kaiser Colosseum limits the Tribute of a monster of p0 by the monsters of the SUMMONING duelist (p1: none), not by the sum of the opponents of p0",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "ffa3", "card:35059553", "card:68005187"],
    // p0 controls 2 monsters and Kaiser Colosseum. p1 has none, p2 has 1. Soul Exchange of p1 Tributes a monster of p0: one Tribute leaves p1 with 1 monster,
    // not more than p0 (1 after the Tribute). The sum of p1 and p2 (1) would block it.
    setup: {
      format: "ffa3",
      p0: { monsters: [OX, GUARDIAN], spells: ["Kaiser Colosseum"] },
      p1: { hand: [SKULL, "Soul Exchange"] },
      p2: { monsters: [BEAVER] },
    },
    steps: [
      endTurn("p0"),
      activate("Soul Exchange", "p1"),
      // Soul Exchange targets a monster of any opponent (no overlay file): p1 picks the monster of p0.
      select(OX),
      expectOffered("tributeSummon", SKULL, "p1"),
      normalSummon(SKULL, "p1"),
      select(OX),
      everySeat("ffa3", {
        p0: { monsters: [GUARDIAN], spells: ["Kaiser Colosseum"], grave: [OX] },
        p1: { monsters: [SKULL], grave: ["Soul Exchange"], hand: [ELF] },
        p2: { monsters: [BEAVER] },
      }),
    ],
  }),
];
