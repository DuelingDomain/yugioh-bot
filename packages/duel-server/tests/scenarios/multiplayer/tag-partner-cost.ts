// R-TAG-PARTNER-COST in Tag: a duelist may use the monsters of the partner as Tributes (Tribute Summon and Tribute Set, from team 0 and from team 1)
// and as the release cost of an effect, and as Fusion, Ritual and Xyz material. The opposing members are never offered, and the partner never frees
// a zone of the summoner. FFA3 and FFA4 are unchanged: there is no partner, and the monsters of the other seats are never Tribute material.
// Plain data (scripts/rule-coverage.ts reads it); tag-partner-cost.test.ts runs it on a live core (NSEAT_LIVE=1). Every scenario ends with the
// state of EVERY seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  activate, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPickOptions, expectPickSeats, pickOpponent, normalSummon, select, setCard, specialSummon,
  type BoardExpect, type DuelistExpect, type OptionRef, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";

const COST = `${SOURCE} [R-TAG-PARTNER-COST]`;
const SKULL = "Summoned Skull"; // Level 6: 1 Tribute
const BEWD = "Blue-Eyes White Dragon"; // Level 8: 2 Tributes
const CANNON = "Cannon Soldier"; // cost: Tribute 1 monster, inflicts 500 damage
const UTOPIA = "Number 39: Utopia"; // Xyz, 2 Level 4 monsters
const RAT = "Giant Rat";
const SANGAN = "Sangan";
const BEAVER = "Beaver Warrior"; // Level 4
const OX = "Battle Ox"; // Level 4
const AXE = "Axe Raider";
const BLS = 5405694; // Black Luster Soldier (Ritual, Level 8), by passcode: the name is shared with a Normal Monster
const GUARDIAN = "Celtic Guardian";
const FANG = "Silver Fang";

/** Option references of cards, for expectPickOptions. */
const cards = (...names: string[]): OptionRef[] => names.map((card) => ({ card }));

/**
 * The state of EVERY seat of a Tag duel, exact for the monster zones, the Spell and Trap zones, the Graveyard, the banished zone and the
 * Life Points of the team (16000 unless the team is given in `lp`). A seat that the spec leaves out is empty. The hand is checked only when named.
 */
function everyTagSeat(spec: Partial<Record<Seat, DuelistExpect>>, lp: { team0?: number; team1?: number } = {}): Step {
  const board: BoardExpect = {};
  for (const seat of ["p0", "p1", "p2", "p3"] as Seat[]) {
    const team = seat === "p0" || seat === "p2" ? lp.team0 : lp.team1;
    board[seat] = { lp: team ?? 16000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  }
  return expectBoard(board);
}

/** The state of EVERY seat of a free-for-all duel with `seats` seats (8000 Life Points each). */
function everyFfaSeat(spec: Partial<Record<"p0" | "p1" | "p2" | "p3", DuelistExpect>>, seats: 3 | 4 = 3): Step {
  const board: BoardExpect = {};
  for (const seat of (["p0", "p1", "p2", "p3"] as const).slice(0, seats)) {
    board[seat] = { lp: 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  }
  return expectBoard(board);
}

const tag = (id: string, title: string, card: number, setup: Record<string, unknown>, steps: Step[]): Scenario =>
  defineScenario({
    id: `tag-partner-cost-${id}`,
    title: `Tag: ${title}`,
    source: COST,
    rules: ["R-TAG-PARTNER-COST"],
    tags: ["multiplayer", "tag", "cost", `card:${card}`],
    setup: { format: "tag", ...setup } as Scenario["setup"],
    steps,
  });

const ffa = (id: string, title: string, card: number, setup: Record<string, unknown>, steps: Step[], format: "ffa3" | "ffa4" = "ffa3"): Scenario =>
  defineScenario({
    id: `tag-partner-cost-${id}`,
    title: `${format === "ffa3" ? "FFA3" : "FFA4"}: ${title}`,
    source: COST,
    rules: ["R-TAG-PARTNER-COST"],
    tags: ["multiplayer", format, "cost", `card:${card}`],
    setup: { format, ...setup } as Scenario["setup"],
    steps,
  });

export const TAG_PARTNER_COST_SCENARIOS: Scenario[] = [
  // Tribute Summon
  tag(
    "tribute-summon-with-only-a-monster-of-the-partner",
    "p0 holds Summoned Skull and no monster, only the partner p2 controls monsters (Giant Rat, Sangan): the Tribute Summon is offered, the Tribute choice lists the 2 monsters of the partner, and the Rat of p2 goes to the Graveyard of p2 (the monsters of p1 and p3 stay)",
    70781052,
    { p0: { hand: [SKULL] }, p1: { monsters: [BEAVER] }, p2: { monsters: [RAT, SANGAN] }, p3: { monsters: [OX] } },
    [
      expectOffered("tributeSummon", SKULL, "p0"),
      normalSummon(SKULL, "p0"),
      expectPickOptions({ count: 2, include: cards(RAT, SANGAN) }, "p0"),
      select(RAT),
      everyTagSeat({ p0: { monsters: [SKULL] }, p1: { monsters: [BEAVER] }, p2: { monsters: [SANGAN], grave: [RAT] }, p3: { monsters: [OX] } }),
    ],
  ),
  tag(
    "tribute-summon-with-an-own-monster-and-a-monster-of-the-partner",
    "p0 Tribute Summons Blue-Eyes White Dragon (2 Tributes) with its own Giant Rat and the Sangan of the partner p2: the choice lists only the 2 monsters of the team, both go to the Graveyard of their owner, and the monsters of p1 and p3 stay",
    89631139,
    { p0: { hand: [BEWD], monsters: [RAT] }, p1: { monsters: [BEAVER] }, p2: { monsters: [SANGAN] }, p3: { monsters: [OX] } },
    [
      normalSummon(BEWD, "p0"),
      expectPickOptions({ count: 2, include: cards(RAT, SANGAN) }, "p0"),
      select(RAT, SANGAN),
      everyTagSeat({ p0: { monsters: [BEWD], grave: [RAT] }, p1: { monsters: [BEAVER] }, p2: { grave: [SANGAN] }, p3: { monsters: [OX] } }),
    ],
  ),
  tag(
    "tribute-summon-needs-the-full-count-the-team-has-one-monster",
    "p0 holds Blue-Eyes White Dragon (2 Tributes) and the team controls only 1 monster (the Sangan of the partner p2) while p1 and p3 control 2: the Tribute Summon is not offered, the opposing monsters are no Tribute",
    89631139,
    { p0: { hand: [BEWD] }, p1: { monsters: [BEAVER] }, p2: { monsters: [SANGAN] }, p3: { monsters: [OX] } },
    [
      expectNotOffered("tributeSummon", BEWD, "p0"),
      endTurn("p0"),
      everyTagSeat({ p0: { hand: [BEWD] }, p1: { monsters: [BEAVER] }, p2: { monsters: [SANGAN] }, p3: { monsters: [OX] } }),
    ],
  ),
  tag(
    "tribute-summon-never-offers-an-opponent-monster",
    "p0 holds Summoned Skull, the team has no monster and p1 and p3 control one each: the Tribute Summon is not offered (an opposing monster is never a Tribute)",
    70781052,
    { p0: { hand: [SKULL] }, p1: { monsters: [RAT] }, p3: { monsters: [SANGAN] } },
    [
      expectNotOffered("tributeSummon", SKULL, "p0"),
      endTurn("p0"),
      everyTagSeat({ p0: { hand: [SKULL] }, p1: { monsters: [RAT] }, p3: { monsters: [SANGAN] } }),
    ],
  ),
  tag(
    "tribute-summon-by-team-1-with-only-a-monster-of-the-partner",
    "p1 (the other team) holds Summoned Skull and no monster, only the partner p3 controls monsters (Giant Rat, Sangan) while p0 and p2 control one each: the Tribute Summon is offered to p1, the choice lists the 2 monsters of p3, and the Rat of p3 goes to the Graveyard of p3 (the monsters of p0 and p2 stay)",
    70781052,
    { p0: { monsters: [BEAVER] }, p1: { hand: [SKULL] }, p2: { monsters: [OX] }, p3: { monsters: [RAT, SANGAN] } },
    [
      endTurn("p0"),
      expectOffered("tributeSummon", SKULL, "p1"),
      normalSummon(SKULL, "p1"),
      expectPickOptions({ count: 2, include: cards(RAT, SANGAN) }, "p1"),
      select(RAT),
      everyTagSeat({ p0: { monsters: [BEAVER] }, p1: { monsters: [SKULL] }, p2: { monsters: [OX] }, p3: { monsters: [SANGAN], grave: [RAT] } }),
    ],
  ),
  tag(
    "tribute-set-with-only-a-monster-of-the-partner",
    "p0 holds Summoned Skull and no monster, only the partner p2 controls monsters (Giant Rat, Sangan): the Tribute Set is offered, the Tribute choice lists the 2 monsters of the partner, and the Rat of p2 goes to the Graveyard of p2 (the monsters of p1 and p3 stay); Summoned Skull is Set face-down",
    70781052,
    { p0: { hand: [SKULL] }, p1: { monsters: [BEAVER] }, p2: { monsters: [RAT, SANGAN] }, p3: { monsters: [OX] } },
    [
      expectOffered("set", SKULL, "p0"),
      setCard(SKULL, "p0"),
      expectPickOptions({ count: 2, include: cards(RAT, SANGAN) }, "p0"),
      select(RAT),
      everyTagSeat({ p0: { monsters: [SKULL], zones: { m0: { card: SKULL, pos: "set" } } }, p1: { monsters: [BEAVER] }, p2: { monsters: [SANGAN], grave: [RAT] }, p3: { monsters: [OX] } }),
    ],
  ),
  tag(
    "tribute-summon-with-a-full-own-zone-lists-the-own-monsters-only",
    "p0 controls 5 monsters (a full zone) and holds Summoned Skull, the partner p2 controls Giant Rat and p1 controls Silver Fang: the Tribute choice lists the 5 own monsters only (the Rat of the partner would not free a zone, the Fang of p1 is no Tribute), and the Tributed Battle Ox goes to the Graveyard of p0",
    70781052,
    { p0: { hand: [SKULL], monsters: [OX, BEAVER, AXE, GUARDIAN, SANGAN] }, p1: { monsters: [FANG] }, p2: { monsters: [RAT] } },
    [
      expectOffered("tributeSummon", SKULL, "p0"),
      normalSummon(SKULL, "p0"),
      expectPickOptions({ count: 5, include: cards(OX, BEAVER, AXE, GUARDIAN, SANGAN), exclude: cards(RAT, FANG) }, "p0"),
      select(OX),
      everyTagSeat({ p0: { monsters: [SKULL, BEAVER, AXE, GUARDIAN, SANGAN], grave: [OX] }, p1: { monsters: [FANG] }, p2: { monsters: [RAT] } }),
    ],
  ),
  // Release cost of an effect
  tag(
    "release-cost-with-a-monster-of-the-partner",
    "Cannon Soldier of p0 is Tributed by its own cost: p0 has no other monster, p2 controls Giant Rat and p1 controls a monster: the cost takes the Rat of the partner (not the monster of p1) and Cannon Soldier inflicts 500 damage to the opposing team",
    11384280,
    { p0: { monsters: [CANNON] }, p1: { monsters: [BEAVER] }, p2: { monsters: [RAT] } },
    [
      activate(CANNON, "p0"),
      expectPickOptions({ count: 2, include: cards(CANNON, RAT) }, "p0"),
      select(RAT),
      everyTagSeat({ p0: { monsters: [CANNON] }, p1: { monsters: [BEAVER] }, p2: { grave: [RAT] } }, { team1: 15500 }),
    ],
  ),
  tag(
    "release-cost-never-offers-an-opponent-monster",
    "Cannon Soldier of p0 is alone on its team and p1 and p3 control a monster each: the cost can take Cannon Soldier only (an opposing monster is never a cost): it Tributes itself and inflicts 500 damage to the opposing team",
    11384280,
    { p0: { monsters: [CANNON] }, p1: { monsters: [BEAVER] }, p3: { monsters: [OX] } },
    [
      activate(CANNON, "p0"), // the only monster the cost can take is Cannon Soldier itself: the engine takes it, no choice is shown
      everyTagSeat({ p0: { grave: [CANNON] }, p1: { monsters: [BEAVER] }, p3: { monsters: [OX] } }, { team1: 15500 }),
    ],
  ),
  tag(
    "release-cost-by-team-1-with-a-monster-of-the-partner",
    "Cannon Soldier of p1 (the other team) is Tributed by its own cost: p1 has no other monster, p3 controls Giant Rat and p0 controls a monster: the cost choice lists Cannon Soldier and the Rat of the partner (not the monster of p0), the Rat of p3 is Tributed and Cannon Soldier inflicts 500 damage to the team of p0",
    11384280,
    { p0: { monsters: [BEAVER] }, p1: { monsters: [CANNON] }, p3: { monsters: [RAT] } },
    [
      endTurn("p0"),
      activate(CANNON, "p1"),
      expectPickOptions({ count: 2, include: cards(CANNON, RAT), exclude: cards(BEAVER) }, "p1"),
      select(RAT),
      everyTagSeat({ p0: { monsters: [BEAVER] }, p1: { monsters: [CANNON] }, p3: { grave: [RAT] } }, { team0: 15500 }),
    ],
  ),
  // Material
  tag(
    "ritual-material-with-a-monster-of-the-partner",
    "p0 Ritual Summons Black Luster Soldier with Black Luster Ritual and the Blue-Eyes White Dragon (Level 8) of the partner p2 (the opposing Axe Raider of p1 stays): the Dragon goes to the Graveyard of p2",
    55761792,
    { p0: { hand: ["Black Luster Ritual", BLS] }, p1: { monsters: [AXE] }, p2: { monsters: [BEWD] } },
    [
      activate("Black Luster Ritual", "p0"),
      select(BEWD),
      everyTagSeat({ p0: { monsters: [BLS], grave: ["Black Luster Ritual"] }, p1: { monsters: [AXE] }, p2: { grave: [BEWD] } }),
    ],
  ),
  tag(
    "xyz-material-with-a-monster-of-the-partner",
    "p0 Xyz Summons Number 39: Utopia from its own Battle Ox and the Beaver Warrior of the partner p2 (the opposing Axe Raider of p1 stays): Utopia holds 2 materials and nobody has a card in the Graveyard",
    84013237,
    { p0: { monsters: [OX], extra: [UTOPIA] }, p1: { monsters: [AXE] }, p2: { monsters: [BEAVER] } },
    [
      specialSummon(UTOPIA, "p0"),
      select(OX, BEAVER),
      everyTagSeat({ p0: { monsters: [UTOPIA], zones: { m0: { card: UTOPIA, materials: 2 } } }, p1: { monsters: [AXE] } }),
    ],
  ),
  tag(
    "fusion-material-with-a-monster-of-the-partner",
    "p0 Fusion Summons Gaia the Dragon Champion with Polymerization, its own Gaia The Fierce Knight from the hand and the Curse of Dragon of the partner p2 (the opposing Axe Raider of p1 stays)",
    24094653,
    { p0: { hand: ["Polymerization", "Gaia The Fierce Knight"], extra: ["Gaia the Dragon Champion"] }, p1: { monsters: [AXE] }, p2: { monsters: ["Curse of Dragon"] } },
    [
      activate("Polymerization", "p0"),
      select("Gaia The Fierce Knight", "Curse of Dragon"),
      everyTagSeat({ p0: { monsters: ["Gaia the Dragon Champion"], grave: ["Polymerization", "Gaia The Fierce Knight"] }, p1: { monsters: [AXE] }, p2: { grave: ["Curse of Dragon"] } }),
    ],
  ),
  // FFA is unchanged
  ffa(
    "ffa3-other-seat-monsters-are-no-tribute",
    "p0 holds Summoned Skull, no monster; p1 and p2 control a monster each: the Tribute Summon is not offered (no seat is a partner in free-for-all)",
    70781052,
    { p0: { hand: [SKULL] }, p1: { monsters: [RAT] }, p2: { monsters: [SANGAN] } },
    [
      expectNotOffered("tributeSummon", SKULL, "p0"),
      endTurn("p0"),
      everyFfaSeat({ p0: { hand: [SKULL] }, p1: { monsters: [RAT] }, p2: { monsters: [SANGAN] } }),
    ],
  ),
  ffa(
    "ffa3-tribute-takes-only-the-own-monster",
    "p0 holds Summoned Skull and controls Giant Rat; p1 and p2 control a monster each: the Tribute choice lists the own Rat only and it goes to the Graveyard of p0 (the monsters of p1 and p2 stay)",
    70781052,
    { p0: { hand: [SKULL], monsters: [RAT] }, p1: { monsters: [BEAVER] }, p2: { monsters: [SANGAN] } },
    [
      normalSummon(SKULL, "p0"),
      expectPickOptions({ count: 1, include: cards(RAT) }, "p0"),
      select(RAT),
      everyFfaSeat({ p0: { monsters: [SKULL], grave: [RAT] }, p1: { monsters: [BEAVER] }, p2: { monsters: [SANGAN] } }),
    ],
  ),
  ffa(
    "ffa3-release-cost-never-offers-another-seat",
    "Cannon Soldier of p0 is alone and p1 and p2 control a monster each: the cost can take Cannon Soldier only (the monsters of the other seats are never a cost): it Tributes itself, p0 picks p1 and p1 takes 500 damage",
    11384280,
    { p0: { monsters: [CANNON] }, p1: { monsters: [BEAVER] }, p2: { monsters: [OX] } },
    [
      activate(CANNON, "p0"), // the only monster the cost can take is Cannon Soldier itself: the engine takes it, no choice is shown
      expectPickSeats(["p1", "p2"], "p0"), // the damage goes to an opponent of the pick
      pickOpponent("p1", "p0"),
      everyFfaSeat({ p0: { grave: [CANNON] }, p1: { monsters: [BEAVER], lp: 7500 }, p2: { monsters: [OX] } }),
    ],
  ),
  ffa(
    "ffa4-other-seat-monsters-are-no-tribute",
    "p0 holds Summoned Skull, no monster; p1, p2 and p3 control a monster each: the Tribute Summon is not offered (no seat is a partner in free-for-all)",
    70781052,
    { p0: { hand: [SKULL] }, p1: { monsters: [RAT] }, p2: { monsters: [SANGAN] }, p3: { monsters: [BEAVER] } },
    [
      expectNotOffered("tributeSummon", SKULL, "p0"),
      endTurn("p0"),
      everyFfaSeat({ p0: { hand: [SKULL] }, p1: { monsters: [RAT] }, p2: { monsters: [SANGAN] }, p3: { monsters: [BEAVER] } }, 4),
    ],
    "ffa4",
  ),
];
