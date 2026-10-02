// Live scenarios for the rules that had no scenario in the rule table (review B, test proof quality): R-COMMON-ALL-BOTH (Dark Hole),
// R-FFA-NEGATE (Solemn Judgment in free-for-all), R-COMMON-CONT-NEG (Jinzo, with a control without Jinzo, and a Tag partner Jinzo),
// R-COMMON-ONGOING (Swords of Revealing Light on all opponents, not on the
// partner). Plain data, also read by scripts/rule-coverage.ts. Every scenario ends with the state of EVERY seat (LP, field, hand, GY, banished).
// Tag: team 0 is p0 and p2, team 1 is p1 and p3. Turn order is p0, p1, p2, p3.

import {
  activate, changePhase, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPrompt, expectResponseOrder, normalSummon, type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const RAT = "Giant Rat";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const WITCH = "Witch of the Black Forest";
const ELF = "Mystical Elf";
const HOLE = "Dark Hole";
const RAIGEKI = "Raigeki";
const SOLEMN = "Solemn Judgment";
const JINZO = "Jinzo";
const TRAP_HOLE = "Trap Hole";
const SWORDS = "Swords of Revealing Light";

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);
const labelOf = (format: Format) => (format === "tag" ? "Tag" : format.toUpperCase());

/** The state of EVERY seat. LP, monsters, Spell and Trap zones, hand, Graveyard and banished zone are exact unless the spec names them. */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>, lp = format === "tag" ? 16000 : 8000): Step {
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp, monsters: [], spells: [], grave: [], banished: [], hand: [], ...spec[seat] };
  return expectBoard(board);
}

// --- Dark Hole: "all monsters on the field" hits every duelist, the activator and the Tag partner included ------------------------------
const ALL_BOTH_RULE = "R-COMMON-ALL-BOTH";
const MONSTER_OF: Record<Seat, string> = { p0: RAT, p1: OX, p2: AXE, p3: FANG };

function darkHole(format: Format): Scenario {
  const seats = seatsOf(format);
  const setup: Scenario["setup"] = { format };
  for (const seat of seats) setup[seat] = { monsters: [MONSTER_OF[seat]], ...(seat === "p0" ? { hand: [HOLE] } : {}) };
  const end: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) end[seat] = { grave: seat === "p0" ? [HOLE, MONSTER_OF[seat]] : [MONSTER_OF[seat]] };
  return defineScenario({
    id: `rule-gaps-dark-hole-all-${format}`,
    title: `${labelOf(format)}: Dark Hole of p0 destroys the monster of every duelist (the own monster, ${format === "tag" ? "the partner and both opponents" : "every opponent"} included) and the Spell goes to the Graveyard of p0`,
    source: `${SOURCE} [${ALL_BOTH_RULE}]`,
    rules: [ALL_BOTH_RULE],
    tags: ["multiplayer", "all-both", format, "card:53129443"],
    setup,
    steps: [activate(HOLE, "p0"), everySeat(format, end)],
  });
}

// --- Solemn Judgment: negates the action of any duelist, from any seat (also the seat that is not next to the active duelist) ---------------
const NEGATE_RULE = "R-FFA-NEGATE";

function solemnSummon(format: "ffa3" | "ffa4", holder: "p2" | "p3"): Scenario {
  const setup: Scenario["setup"] = { format, p0: { hand: [WITCH] }, [holder]: { spells: [{ card: SOLEMN, pos: "set" }] } };
  return defineScenario({
    id: `rule-gaps-solemn-summon-${format}-${holder}`,
    title: `${labelOf(format)}: the set Solemn Judgment of ${holder} (the seat after the others in the chain order) negates the Normal Summon of p0: the monster is destroyed and ${holder} pays half of its LP`,
    source: `${SOURCE} [${NEGATE_RULE}]`,
    rules: [NEGATE_RULE],
    tags: ["multiplayer", "negate", "chain", format, "card:41420027"],
    setup,
    steps: [
      normalSummon(WITCH, "p0"),
      expectPrompt({ by: holder, context: "chain" }),
      activate(SOLEMN, holder),
      expectResponseOrder(holder),
      // p0 loses the monster of the summon (negate and destroy), the holder pays 4000 LP, nobody else changes.
      expectBoard(Object.fromEntries(seatsOf(format).map((seat) => [seat, {
        lp: seat === holder ? 4000 : 8000, monsters: [], spells: [], hand: [], banished: [],
        grave: seat === "p0" ? [WITCH] : seat === holder ? [SOLEMN] : [],
      }])) as BoardExpect),
    ],
  });
}

function solemnSpell(): Scenario {
  return defineScenario({
    id: "rule-gaps-solemn-spell-ffa3-p2",
    title: "FFA3: the set Solemn Judgment of p2 negates the activation of Raigeki of p0: p1 and p2 keep their monsters, Raigeki goes to the Graveyard and p2 pays half of its LP",
    source: `${SOURCE} [${NEGATE_RULE}]`,
    rules: [NEGATE_RULE],
    tags: ["multiplayer", "negate", "chain", "ffa3", "card:41420027", "card:12580477"],
    setup: {
      format: "ffa3",
      p0: { hand: [RAIGEKI] },
      p1: { monsters: [OX] },
      p2: { monsters: [AXE], spells: [{ card: SOLEMN, pos: "set" }] },
    },
    steps: [
      activate(RAIGEKI, "p0"),
      expectPrompt({ by: "p2", context: "chain" }),
      activate(SOLEMN, "p2"),
      everySeat("ffa3", {
        p0: { grave: [RAIGEKI] },
        p1: { monsters: [OX] },
        p2: { lp: 4000, monsters: [AXE], grave: [SOLEMN] },
      }),
    ],
  });
}

// --- Jinzo: a continuous negation of all Traps. It holds for every duelist at the table ------------------------------------------------
const CONT_NEG_RULE = "R-COMMON-CONT-NEG";

/** The seats with a set Trap Hole: every opponent of p0 (in Tag the two opposing duelists). */
const trapSeats = (format: Format): Seat[] => (format === "tag" ? ["p1", "p3"] : seatsOf(format).slice(1));
const SET_TRAP = { card: TRAP_HOLE, pos: "set" as const };

function jinzoStopsOpponents(format: Format): Scenario {
  const setup: Scenario["setup"] = { format, p0: { hand: [OX], monsters: [JINZO] } };
  const end: Partial<Record<Seat, DuelistExpect>> = { p0: { monsters: [JINZO, OX] } };
  for (const seat of trapSeats(format)) {
    setup[seat] = { spells: [SET_TRAP] };
    end[seat] = { spells: [TRAP_HOLE] };
  }
  return defineScenario({
    id: `rule-gaps-jinzo-stops-every-opponent-${format}`,
    title: `${labelOf(format)}: with Jinzo of p0 on the field, the set Trap Hole of every opponent (${trapSeats(format).join(", ")}) gets no chain window on the Normal Summon of Battle Ox and the Ox stays (nobody loses a card)`,
    source: `${SOURCE} [${CONT_NEG_RULE}]`,
    rules: [CONT_NEG_RULE],
    tags: ["multiplayer", "continuous-negate", "trap", format, "card:77585513", "card:4206964"],
    setup,
    steps: [normalSummon(OX, "p0"), expectResponseOrder(), expectPrompt({ by: "p0", context: "action" }), everySeat(format, end)],
  });
}

function jinzoControl(format: Format): Scenario {
  return defineScenario({
    id: `rule-gaps-jinzo-control-no-jinzo-${format}`,
    title: `${labelOf(format)} control: without Jinzo, the same set Trap Hole of p1 answers the Normal Summon of Battle Ox and destroys it`,
    source: `${SOURCE} [${CONT_NEG_RULE}]`,
    rules: [CONT_NEG_RULE],
    tags: ["multiplayer", "continuous-negate", "trap", "control", format, "card:77585513", "card:4206964"],
    setup: { format, p0: { hand: [OX] }, p1: { spells: [SET_TRAP] } },
    steps: [
      normalSummon(OX, "p0"),
      expectPrompt({ by: "p1", context: "chain" }),
      activate(TRAP_HOLE, "p1"),
      everySeat(format, { p0: { grave: [OX] }, p1: { grave: [TRAP_HOLE] } }),
    ],
  });
}

function jinzoPartnerTag(): Scenario {
  return defineScenario({
    id: "rule-gaps-jinzo-of-partner-stops-trap-tag",
    title: "Tag: Jinzo of p3 stops the set Trap Hole of its own partner (p1) as well (a continuous negation holds for the partner; only a card that negates one activation does not): no chain window on the Normal Summon of Battle Ox by p0",
    source: `${SOURCE} [${CONT_NEG_RULE}]`,
    rules: [CONT_NEG_RULE],
    tags: ["multiplayer", "continuous-negate", "trap", "partner", "tag", "card:77585513", "card:4206964"],
    setup: { format: "tag", p0: { hand: [OX] }, p1: { spells: [SET_TRAP] }, p3: { monsters: [JINZO] } },
    steps: [
      normalSummon(OX, "p0"),
      expectResponseOrder(),
      expectPrompt({ by: "p0", context: "action" }),
      everySeat("tag", { p0: { monsters: [OX] }, p1: { spells: [TRAP_HOLE] }, p3: { monsters: [JINZO] } }),
    ],
  });
}

// --- Ongoing restriction on "your opponent": every opponent, never the partner ---------------------------------------------------------
const ONGOING_RULE = "R-COMMON-ONGOING";

// A duelist cannot attack in its first turn, so the opposing monsters are checked in the second turn of their controller (the Battle Phase is offered, the attack is not). Swords of Revealing Light
// lasts for 3 turns of the opponents: the monsters of an opposing duelist cannot attack (no attack is offered in the Battle Phase).
const attackTurn = (by: Seat, monster: string, canAttack: boolean): Step[] => [
  changePhase("battle", by),
  canAttack ? expectOffered("attack", monster, by) : expectNotOffered("attack", monster, by),
  endTurn(by),
];

function swordsFfa3(): Scenario {
  return defineScenario({
    id: "rule-gaps-swords-all-opponents-ffa3",
    title: "FFA3: Swords of Revealing Light of p0 (turn 1) stops the attack of the monsters of p1 (its second turn 5) and not the attack of p0 (turn 4); after the 3 turns of the opponents (2, 3 and 5) it is destroyed and p2 attacks in turn 6",
    source: `${SOURCE} [${ONGOING_RULE}]`,
    rules: [ONGOING_RULE],
    tags: ["multiplayer", "ongoing", "ffa3", "card:72302403"],
    setup: { format: "ffa3", p0: { hand: [SWORDS], monsters: [RAT] }, p1: { monsters: [OX] }, p2: { monsters: [AXE] } },
    steps: [
      activate(SWORDS, "p0"),
      endTurn("p0"), endTurn("p1"), endTurn("p2"),
      ...attackTurn("p0", RAT, true),
      ...attackTurn("p1", OX, false),
      ...attackTurn("p2", AXE, true),
      everySeat("ffa3", { p0: { monsters: [RAT], grave: [SWORDS], hand: [ELF, ELF] }, p1: { monsters: [OX], hand: [ELF, ELF] }, p2: { monsters: [AXE], hand: [ELF, ELF] } }),
    ],
  });
}

function swordsTag(): Scenario {
  return defineScenario({
    id: "rule-gaps-swords-opponents-not-partner-tag",
    title: "Tag: Swords of Revealing Light of p2 (turn 3) stops the attack of the monsters of both opponents (p1 in turn 6 and p3 in turn 8) and not the attack of the partner (p0 in turn 5) or its own (p2 in turn 7); it is destroyed after the 3 turns of the opponents (4, 6 and 8)",
    source: `${SOURCE} [${ONGOING_RULE}]`,
    rules: [ONGOING_RULE],
    tags: ["multiplayer", "ongoing", "tag", "card:72302403"],
    setup: { format: "tag", p0: { monsters: [RAT] }, p1: { monsters: [OX] }, p2: { hand: [SWORDS], monsters: [AXE] }, p3: { monsters: [FANG] } },
    steps: [
      endTurn("p0"), endTurn("p1"),
      activate(SWORDS, "p2"),
      endTurn("p2"), endTurn("p3"),
      ...attackTurn("p0", RAT, true),
      ...attackTurn("p1", OX, false),
      ...attackTurn("p2", AXE, true),
      ...attackTurn("p3", FANG, false),
      everySeat("tag", {
        p0: { monsters: [RAT], hand: [ELF, ELF] }, p1: { monsters: [OX], hand: [ELF, ELF] },
        p2: { monsters: [AXE], grave: [SWORDS], hand: [ELF, ELF] }, p3: { monsters: [FANG], hand: [ELF, ELF] },
      }),
    ],
  });
}

export const RULE_GAP_SCENARIOS: Scenario[] = [
  darkHole("ffa3"), darkHole("ffa4"), darkHole("tag"),
  solemnSummon("ffa3", "p2"), solemnSummon("ffa4", "p3"), solemnSpell(),
  jinzoStopsOpponents("ffa3"), jinzoStopsOpponents("ffa4"), jinzoStopsOpponents("tag"),
  jinzoControl("ffa3"), jinzoControl("ffa4"), jinzoControl("tag"), jinzoPartnerTag(),
  swordsFfa3(), swordsTag(),
];
