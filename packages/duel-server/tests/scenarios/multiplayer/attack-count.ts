// Live scenarios of the cards that count the direct attacks that a duelist faced in one turn (Confusion Chaff 67630339, Ogre of the Scarlet
// Sorrow 82670878). The count is kept per ATTACKED duelist (FFA the seat, Tag the team). A holder is offered the card only when the attack that
// reached the count goes to the holder: a count of 2 that stays from an earlier attack must not offer the card again when a LATER direct attack
// goes to another opponent. Plain data (scripts/rule-coverage.ts reads it); attack-count.test.ts runs it on a live core (NSEAT_LIVE=1) with the
// real card scripts and the overlay. Every scenario ends with the state of EVERY seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  activate, attack, changePhase, endTurn, expectBoard, expectOffered, expectPrompt, faceDown, no, pass, pickOpponent,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const RAT = "Giant Rat"; // 1400 ATK
const OX = "Battle Ox"; // 1700 ATK
const AXE = "Axe Raider"; // 1700 ATK
const FANG = "Silver Fang"; // 1200 ATK
const CHAFF = "Confusion Chaff";
const OGRE = "Ogre of the Scarlet Sorrow";

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);

/** The state of EVERY seat: monsters, Spell and Trap zones, Graveyard, banished zone and LP are exact (a seat that the spec leaves out is empty). */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  // Tag: a team has one LP total, so the partner (p2 of p0, p3 of p1) reads the LP that the spec gives for the first seat of the team.
  const partner: Record<Seat, Seat> = { p0: "p2", p1: "p3", p2: "p0", p3: "p1" };
  for (const seat of seatsOf(format)) {
    const teamLp = format === "tag" ? (spec[seat]?.lp ?? spec[partner[seat]]?.lp ?? 16000) : (spec[seat]?.lp ?? 8000);
    board[seat] = { monsters: [], spells: [], grave: [], banished: [], ...spec[seat], lp: teamLp };
  }
  return expectBoard(board);
}

const label = (format: Format): string => (format === "tag" ? "Tag" : format.toUpperCase());
const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;

/** p0 holds the card (p2 in Tag: the partner of the attacked p0). p1 has attackFirstTurn, so it attacks in its first turn. */
const holderOf = (format: Format): Seat => (format === "tag" ? "p2" : "p0");

/** The seat of the opponent that receives the LATER direct attack in the "stale count" scenarios (never the holder). */
const OTHER: Record<"ffa3" | "ffa4", Seat> = { ffa3: "p2", ffa4: "p3" };

/** Confusion Chaff: the SECOND direct attack at the holder is offered; it makes the second attacker battle the first one. */
function chaffResolves(format: Format): Scenario {
  const holder = holderOf(format);
  const setup: Record<string, unknown> = { format, attackFirstTurn: true, p1: { monsters: [RAT, OX] } };
  setup[holder] = { spells: [faceDown(CHAFF)] };
  for (const seat of seatsOf(format)) if (!(seat in setup)) setup[seat] = {};
  const tag = format === "tag";
  return defineScenario({
    id: `attack-count-${format}-confusion-chaff-second-direct-attack-at-the-holder-is-offered`,
    title: `${label(format)}: Confusion Chaff of ${holder} is offered at the 2nd direct attack of p1 at ${tag ? "the team of p0" : "p0"} (not at the 1st), and it makes the 2nd attacker battle the 1st`,
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ATTACK"],
    tags: ["multiplayer", "attack", "trigger", format, "card:67630339"],
    setup: setup as Scenario["setup"],
    steps: [
      endTurn("p0"),
      changePhase("battle", "p1"),
      attack(RAT, "direct", "p1"),
      pickOpponent("p0", "p1"),
      attack(OX, "direct", "p1"),
      pickOpponent("p0", "p1"),
      activate(CHAFF, holder),
      // Battle Ox (1700) battles Giant Rat (1400): the Rat is destroyed and its controller p1 takes 300. The first attack went to p0 (1400 damage).
      everySeat(format, {
        p1: { lp: (tag ? 16000 : 8000) - 300, monsters: [OX], grave: [RAT] },
        [holder]: { grave: [CHAFF] },
        p0: { lp: (tag ? 16000 : 8000) - 1400, ...(holder === "p0" ? { grave: [CHAFF] } : {}) },
      }),
    ],
  });
}

/** Two direct attacks at p0 (the count of p0 is 2, the card was offered and passed), then a 3rd attack at ANOTHER opponent: no new offer. */
function chaffStale(format: "ffa3" | "ffa4"): Scenario {
  const other = OTHER[format];
  const setup: Record<string, unknown> = { format, attackFirstTurn: true, p0: { spells: [faceDown(CHAFF)] }, p1: { monsters: [RAT, OX, AXE] } };
  for (const seat of seatsOf(format)) if (!(seat in setup)) setup[seat] = {};
  return defineScenario({
    id: `attack-count-${format}-confusion-chaff-not-offered-again-when-a-later-direct-attack-goes-to-another-opponent`,
    title: `${label(format)}: Confusion Chaff of p0 is offered at the 2nd direct attack at p0 and passed; the 3rd direct attack goes to ${other}: p0 is NOT offered the card again (the count of p0 stays 2)`,
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ATTACK"],
    tags: ["multiplayer", "attack", "trigger", format, "card:67630339"],
    setup: setup as Scenario["setup"],
    steps: [
      endTurn("p0"),
      changePhase("battle", "p1"),
      attack(RAT, "direct", "p1"),
      pickOpponent("p0", "p1"),
      attack(OX, "direct", "p1"),
      pickOpponent("p0", "p1"),
      expectOffered("activate", CHAFF, "p0"),
      pass("p0"),
      attack(AXE, "direct", "p1"),
      pickOpponent(other, "p1"),
      expectPrompt({ by: "p1", offers: ["to_m2", "to_ep"] }),
      everySeat(format, {
        p0: { lp: 8000 - 1400 - 1700, spells: [CHAFF] },
        p1: { monsters: [RAT, OX, AXE] },
        [other]: { lp: 8000 - 1700 },
      }),
    ],
  });
}

/** Ogre of the Scarlet Sorrow: the SECOND direct attack at the holder offers the Special Summon from the hand. */
function ogreResolves(format: Format): Scenario {
  const holder = holderOf(format);
  const setup: Record<string, unknown> = { format, attackFirstTurn: true, p1: { monsters: [RAT, OX] } };
  setup[holder] = { hand: [OGRE] };
  for (const seat of seatsOf(format)) if (!(seat in setup)) setup[seat] = {};
  const tag = format === "tag";
  return defineScenario({
    id: `attack-count-${format}-ogre-of-the-scarlet-sorrow-second-direct-attack-at-the-holder-is-offered`,
    title: `${label(format)}: Ogre of the Scarlet Sorrow of ${holder} is offered at the 2nd direct attack of p1 at ${tag ? "the team of p0" : "p0"} (not at the 1st) and is Special Summoned`,
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ATTACK"],
    tags: ["multiplayer", "attack", "trigger", format, "card:82670878"],
    setup: setup as Scenario["setup"],
    steps: [
      endTurn("p0"),
      changePhase("battle", "p1"),
      attack(RAT, "direct", "p1"),
      pickOpponent("p0", "p1"),
      attack(OX, "direct", "p1"),
      pickOpponent("p0", "p1"),
      activate(OGRE, holder),
      // Ogre is Special Summoned in the replay of the attack; p1 does not continue it (p0 took the 1400 of the first attack only).
      expectPrompt({ by: "p1", offers: ["yes", "no"] }),
      no("p1"),
      everySeat(format, {
        p0: { lp: (tag ? 16000 : 8000) - 1400, monsters: holder === "p0" ? [OGRE] : [] },
        p1: { monsters: [RAT, OX] },
        ...(tag ? { p2: { monsters: [OGRE] } } : {}),
      }),
    ],
  });
}

/** Two direct attacks at p0 (offered and passed), then TWO direct attacks at ANOTHER opponent: its count reaches 2 and raises the event, p0 is not asked. */
function ogreStale(format: "ffa3" | "ffa4"): Scenario {
  const other = OTHER[format];
  const setup: Record<string, unknown> = { format, attackFirstTurn: true, p0: { hand: [OGRE] }, p1: { monsters: [RAT, OX, AXE, FANG] } };
  for (const seat of seatsOf(format)) if (!(seat in setup)) setup[seat] = {};
  return defineScenario({
    id: `attack-count-${format}-ogre-of-the-scarlet-sorrow-not-offered-again-when-the-count-of-another-opponent-reaches-2`,
    title: `${label(format)}: Ogre of p0 is offered at the 2nd direct attack at p0 and passed; the 2nd direct attack at ${other} raises the event too: p0 is NOT offered the card again`,
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ATTACK"],
    tags: ["multiplayer", "attack", "trigger", format, "card:82670878"],
    setup: setup as Scenario["setup"],
    steps: [
      endTurn("p0"),
      changePhase("battle", "p1"),
      attack(RAT, "direct", "p1"),
      pickOpponent("p0", "p1"),
      attack(OX, "direct", "p1"),
      pickOpponent("p0", "p1"),
      expectOffered("activate", OGRE, "p0"),
      pass("p0"),
      attack(AXE, "direct", "p1"),
      pickOpponent(other, "p1"),
      attack(FANG, "direct", "p1"),
      pickOpponent(other, "p1"),
      expectPrompt({ by: "p1", offers: ["to_m2", "to_ep"] }),
      everySeat(format, {
        p0: { lp: 8000 - 1400 - 1700, hand: [OGRE] },
        p1: { monsters: [RAT, OX, AXE, FANG] },
        [other]: { lp: 8000 - 1700 - 1200 },
      }),
    ],
  });
}

export const ATTACK_COUNT_SCENARIOS: Scenario[] = [
  chaffResolves("ffa3"),
  chaffResolves("ffa4"),
  chaffResolves("tag"),
  chaffStale("ffa3"),
  chaffStale("ffa4"),
  ogreResolves("ffa3"),
  ogreResolves("ffa4"),
  ogreResolves("tag"),
  ogreStale("ffa3"),
  ogreStale("ffa4"),
];
