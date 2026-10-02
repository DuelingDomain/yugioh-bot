// Live scenarios of the summon limits whose value function gets a folded player: Gozen Match and Rivalry of Warlords (the CANNOT_SUMMON target
// reads the field of the duelist that summons). Plain data (scripts/rule-coverage.ts
// reads it). value-limits.test.ts runs it on a live core (NSEAT_LIVE=1) with the real card scripts and the overlay, on the Standard multi core
// and again on the Domain multi core. Every scenario ends with the state of EVERY seat.
//
// The question: at three seats, the parameters sump and targetp of such a function are folded (0 for the owner of the effect, 1 for any other seat),
// and a read of the field with the folded 1 gives the monsters of EVERY opponent of the owner together. So the stock function of Gozen Match and
// Rivalry of Warlords limited a duelist by the fields of all the other duelists. The overlay (multi-scripts-src c53334471 and c90846359) reads the
// field of the summoner: the real seat of the controller of the summoned card, one duelist at a time (aux.MPForEachDuelist). The scenarios prove it
// for each seat in its own turn.

import {
  activate, endTurn, expectBoard, expectNotOffered, expectOffered, faceDown, normalSummon,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const GOZEN = "Gozen Match";
const RIVALRY = "Rivalry of Warlords";
const OX = "Battle Ox"; // EARTH, Beast-Warrior, Level 4
const RAT = "Giant Rat"; // EARTH, Beast, Level 4
const SANGAN = "Sangan"; // DARK, Fiend, Level 3
const KURIBOH = "Kuriboh"; // DARK, Fiend, Level 1
const ELF = "Mystical Elf"; // the card that each duelist draws

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);

function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

const EACH_PLAYER = `${SOURCE} [R-COMMON-EACH-PLAYER], value functions with a folded player (card scripts c53334471.lua, c90846359.lua)`;

/**
 * Gozen Match (attribute) and Rivalry of Warlords (Type): p0 controls the Spell and a face-up monster of the first kind, p1 controls a monster of the
 * second kind, p2 controls no monster (and p3, when there is one, controls a Giant Rat). In its own turn each duelist may Normal Summon only a monster
 * of the kind that its OWN field has (p2: any). Tag: the partners share the field of the team ([R-TAG-SHARED-CARDS]), so p2 is limited like p0 and
 * p3 like p1 (the choice of the kind to keep, when the Spell is activated, joins the monsters of a team too, so p3 controls no monster at the start). A function that read the field of the owner, or the fields of all the opponents together, would offer
 * p1 the monster of the kind of p0 and refuse the other one.
 */
function sameKind(card: "gozen" | "rivalry", format: Format): Scenario {
  const spell = card === "gozen" ? GOZEN : RIVALRY;
  const seats = seatsOf(format);
  const fourth = seats.length === 4;
  const tag = format === "tag";
  const turns: Step[] = [
    activate(spell, "p0"),
    expectOffered("normalSummon", OX, "p0"),
    expectNotOffered("normalSummon", SANGAN, "p0"),
    normalSummon(OX, "p0"),
    endTurn("p0"),
    expectOffered("normalSummon", KURIBOH, "p1"),
    expectNotOffered("normalSummon", RAT, "p1"),
    normalSummon(KURIBOH, "p1"),
    endTurn("p1"),
    // Tag: the partner of p0 shares the field of the team ([R-TAG-SHARED-CARDS]), so p2 is limited by the Battle Ox of p0
    // (Giant Rat has the Attribute of Battle Ox but not its Type)
    tag ? expectNotOffered("normalSummon", SANGAN, "p2") : expectOffered("normalSummon", SANGAN, "p2"),
    card === "rivalry" && tag ? expectNotOffered("normalSummon", RAT, "p2") : expectOffered("normalSummon", RAT, "p2"),
    ...(tag ? [expectOffered("normalSummon", OX, "p2"), normalSummon(OX, "p2")] : [normalSummon(RAT, "p2")]),
  ];
  if (fourth) {
    turns.push(
      endTurn("p2"),
      // Tag: p3 shares the field of p1 (Sangan, Kuriboh), so p3 may Normal Summon only a DARK monster
      expectOffered("normalSummon", tag ? KURIBOH : RAT, "p3"),
      expectNotOffered("normalSummon", tag ? RAT : KURIBOH, "p3"),
      normalSummon(tag ? KURIBOH : RAT, "p3"),
    );
  }
  turns.push(
    everySeat(format, {
      p0: { hand: [SANGAN], monsters: [OX, OX], spells: [spell] },
      p1: { hand: [RAT, ELF], monsters: [SANGAN, KURIBOH] },
      p2: tag ? { hand: [SANGAN, RAT, ELF], monsters: [OX] } : { hand: [SANGAN, ELF], monsters: [RAT] },
      ...(fourth ? { p3: tag ? { hand: [RAT, ELF], monsters: [KURIBOH] } : { hand: [KURIBOH, ELF], monsters: [RAT, RAT] } } : {}),
    }),
  );
  const first = "p0 may Normal Summon only the second Battle Ox and not Sangan, p1 only Kuriboh and not Giant Rat, p2 either Sangan or Giant Rat";
  const who = tag
    ? "p0 and its partner p2 may Normal Summon only a Battle Ox (not Sangan; Giant Rat only for Gozen Match), p1 and its partner p3 only a DARK Kuriboh"
    : fourth ? `${first}, p3 only Giant Rat and not Kuriboh` : first;
  return defineScenario({
    id: `value-limits-${format}-${card === "gozen" ? "gozen-match" : "rivalry-of-warlords"}-each-seat-is-limited-by-its-own-field`,
    title: `${format.toUpperCase()}: p0 activates ${spell}. p0 has a Battle Ox (EARTH, Beast-Warrior), p1 has a Sangan (DARK, Fiend), p2 has no monster${fourth ? (format === "tag" ? ", p3 has no monster" : ", p3 has a Giant Rat (EARTH, Beast)") : ""}: ${who}; every seat keeps the state it must have`,
    source: EACH_PLAYER,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "value-limits", "folded-player", format, `card:${card === "gozen" ? 53334471 : 90846359}`],
    setup: {
      format,
      p0: { hand: [SANGAN, OX], monsters: [OX], spells: [faceDown(spell)], deck: [ELF] },
      p1: { hand: [KURIBOH, RAT], monsters: [SANGAN], deck: [ELF] },
      p2: { hand: tag ? [SANGAN, RAT, OX] : [SANGAN, RAT], deck: [ELF] },
      ...(fourth ? { p3: { hand: [RAT, KURIBOH], monsters: format === "tag" ? [] : [RAT], deck: [ELF] } } : {}),
    },
    steps: turns,
  });
}

export const VALUE_LIMIT_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as const).flatMap((format) => [sameKind("gozen", format), sameKind("rivalry", format)]);
