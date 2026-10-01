// Live scenarios of the R1 cards that the Table test listed as known gaps (Grapha, Dangerous Machine Type-6) and of the R1 stock parts that
// were checked against the owner rules (Q3 each duelist, R-COMMON-OPP-PICK). Plain data, also read by scripts/rule-coverage.ts;
// gaps-r1.test.ts runs it on a live core (NSEAT_LIVE=1), on the Standard multi core and again on the Domain multi core. Every scenario uses
// the real card scripts plus the overlay, and ends with the state of EVERY seat (LP, field, hand, GY, banished zone).

import {
  activate, defineScenario, endTurn, expectBoard, expectPickSeats, pickOpponent, select, specialSummon, yes, zone,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const RAT = "Giant Rat";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const ELF = "Mystical Elf";
const HOLE = "Dark Hole";
const MACHINE = "Dangerous Machine Type-6";
const GRAPHA = "Grapha, Dragon Overlord of Dark World";

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);
const labelOf = (format: Format) => (format === "tag" ? "Tag" : format.toUpperCase());

/** The state of EVERY seat. LP, monsters, Spell and Trap zones, hand, Graveyard and banished zone are exact unless the spec names them. */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>, lp = format === "tag" ? 16000 : 8000): Step {
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp, monsters: [], spells: [], grave: [], banished: [], hand: [], ...spec[seat] };
  return expectBoard(board);
}

// --- Grapha, Dragon Overlord of Dark World -----------------------------------------------------------------------------------------
// The first effect changes the chain link of another duelist into "the controller of Grapha discards 1 card". The new operation runs as the
// link of the duelist that activated Dark Hole (no bound opponent there), so the overlay binds the seat of the controller of Grapha again.
// Only that seat discards: the activator, the third seat and in Tag the partners keep their hands and fields (Dark Hole is not applied).
const GRAPHA_SOURCE = `${SOURCE} [R-FFA-CHAIN], card decisions 2026-10-01: Grapha (the changed link makes the controller of Grapha discard 1 card, nobody else)`;

function grapha(format: Format): Scenario {
  const tag = format === "tag";
  const setup: Scenario["setup"] = {
    format,
    p0: { hand: [HOLE], monsters: [RAT] },
    p1: { hand: [OX], monsters: [GRAPHA] },
    p2: { hand: [AXE], monsters: [ELF] },
    ...(tag ? { p3: { hand: [FANG] } } : {}),
  };
  return defineScenario({
    id: `gaps-r1-${format}-grapha-changed-link-makes-its-controller-discard`,
    title: `${labelOf(format)}: p0 activates Dark Hole, p1 answers with Grapha: Dark Hole is changed, only p1 (the controller of Grapha) discards 1 card, every monster stays`,
    source: GRAPHA_SOURCE,
    rules: tag ? ["R-TAG-PARTNER"] : ["R-FFA-CHAIN"],
    tags: ["multiplayer", "gaps-r1", "r1", "chain", format, "card:39552584", "card:53129443"],
    setup,
    steps: [
      activate(HOLE, "p0"),
      activate(GRAPHA, "p1"),
      everySeat(format, {
        p0: { monsters: [RAT], grave: [HOLE] },
        p1: { monsters: [GRAPHA], grave: [OX] },
        p2: { monsters: [ELF], hand: [AXE] },
        ...(tag ? { p3: { hand: [FANG] } } : {}),
      }),
    ],
  });
}

// --- Dangerous Machine Type-6 -----------------------------------------------------------------------------------------------------------
// A forced Standby Phase effect of p0 (the first Standby Phase of the duel). The die is rolled in the operation; results 2 (the hand of "your
// opponent" is discarded) and 4 (your opponent draws) act on ONE opponent. The owner picks it when the effect is put on the chain
// (R-COMMON-OPP-PICK), before the die is rolled. Result 5 (destroy a monster of your opponent) is a field: it selects among the monsters of every
// opponent (a field is not part of R-COMMON-OPP-PICK), so p0 selects the monster of p1 here, which is NOT the picked opponent. The last opponent is picked, never p1, so a bind on the first
// opponent would show. The die is the first draw of the duel generator: 5 * seed[1] rotated by 7 bits, times 9, modulo 6, plus 1. A seed word
// of this size gives a result that does not depend on the format or on the core: 2 (3494825834153508910), 4 (3718197871008284709), 5
// (4388313981572612106). Every seat has a 2-card Deck of one card name, so the setup shuffle does not change the draw.
const DICE_RULE = `${SOURCE} [R-COMMON-OPP-PICK], card decisions 2026-10-01 Q4: Dangerous Machine Type-6 (the die result acts on ONE picked opponent)`;
const MACHINE_PICKS: Record<"ffa3" | "tag", Seat[]> = { ffa3: ["p1", "p2"], tag: ["p1", "p3"] };
const MACHINE_SEEDS = { 2: "3494825834153508910", 4: "3718197871008284709", 5: "4388313981572612106" } as const;
const MACHINE_HAND: Record<Seat, string> = { p0: RAT, p1: OX, p2: FANG, p3: ELF };
const MACHINE_FIELD: Record<Seat, string> = { p0: ELF, p1: AXE, p2: RAT, p3: OX };
const MACHINE_DECK: Record<Seat, string> = { p0: OX, p1: AXE, p2: ELF, p3: RAT };

function dangerousMachine(format: "ffa3" | "tag", die: 2 | 4 | 5): Scenario {
  const seats = seatsOf(format);
  const picked = MACHINE_PICKS[format][MACHINE_PICKS[format].length - 1];
  const setup: Scenario["setup"] = { format };
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    (setup as Record<string, unknown>)[seat] = {
      hand: [MACHINE_HAND[seat]],
      monsters: [MACHINE_FIELD[seat]],
      deck: [MACHINE_DECK[seat], MACHINE_DECK[seat]],
      ...(seat === "p0" ? { spells: [{ card: MACHINE, pos: "up" }] } : {}),
    };
    spec[seat] = { hand: [MACHINE_HAND[seat]], monsters: [MACHINE_FIELD[seat]], ...(seat === "p0" ? { spells: [MACHINE] } : {}) };
  }
  const what =
    die === 2 ? `the hand card of ${picked} is discarded` : die === 4 ? `${picked} draws 1 card` : `p0 selects the monster of p1 (a field is not bound to the pick, any opponent) and it is destroyed`;
  if (die === 2) spec[picked] = { ...spec[picked], hand: [], grave: [MACHINE_HAND[picked]] };
  if (die === 4) spec[picked] = { ...spec[picked], hand: [MACHINE_HAND[picked], MACHINE_DECK[picked]] };
  if (die === 5) spec.p1 = { ...spec.p1, monsters: [], grave: [MACHINE_FIELD.p1] };
  return defineScenario({
    id: `gaps-r1-${format}-dangerous-machine-die-${die}-${die === 2 ? "discard-of-the-picked-opponent" : die === 4 ? "draw-of-the-picked-opponent" : "destroy-of-an-opponent-monster"}`,
    title: `${labelOf(format)}: the Standby Phase effect of Dangerous Machine Type-6 of p0, p0 picks ${picked}, the die is ${die}: ${what}; every other seat keeps its hand, field and Graveyard`,
    source: DICE_RULE,
    rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "gaps-r1", "r1", "dice", "opp-pick", format, "card:76895648"],
    seed: ["1", MACHINE_SEEDS[die], "3", "4"],
    setup,
    steps: [expectPickSeats(MACHINE_PICKS[format], "p0"), pickOpponent(picked, "p0"), ...(die === 5 ? [select({ card: MACHINE_FIELD.p1, owner: "p1" })] : []), everySeat(format, spec)],
  });
}

// --- Awakening of the Possessed - Gagigobyte ------------------------------------------------------------------------------------------
// After its own Special Summon: "your opponent sends 1 card from the hand to the Graveyard (at random), then both players draw 1". The hand of
// "your opponent" is R-COMMON-OPP-PICK: p0 picks ONE opponent when it activates the effect, and the random discard takes a card of that hand only.
// Every duelist draws 1 card after it (Q3, the Tag partner too). Every seat has a hand card and a Deck of 2 cards of one name.
const GAGI = "Awakening of the Possessed - Gagigobyte";
const MEISEI = "Sealmaster Meisei";
const HYOSUBE = "Hyosube";
const GAGI_RULE = `${SOURCE} [R-COMMON-OPP-PICK], card decisions 2026-10-01 Q3/Q4: Awakening of the Possessed - Gagigobyte (a random discard from the hand of ONE picked opponent, then every duelist draws)`;
const GAGI_HAND: Record<Seat, string> = { p0: RAT, p1: OX, p2: AXE, p3: FANG };
const GAGI_DECK: Record<Seat, string> = { p0: ELF, p1: RAT, p2: OX, p3: AXE };

function gagigobyte(format: "ffa3" | "tag", seedWord: string): Scenario {
  const seats = seatsOf(format);
  const picks: Seat[] = format === "tag" ? ["p1", "p3"] : ["p1", "p2"];
  const picked = picks[picks.length - 1];
  const setup: Scenario["setup"] = { format };
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    (setup as Record<string, unknown>)[seat] = {
      hand: seat === "p0" ? [GAGI] : [GAGI_HAND[seat]],
      ...(seat === "p0" ? { monsters: [MEISEI, HYOSUBE] } : {}),
      deck: [GAGI_DECK[seat], GAGI_DECK[seat]],
    };
    spec[seat] = {
      monsters: seat === "p0" ? [GAGI] : [],
      grave: [...(seat === "p0" ? [MEISEI, HYOSUBE] : []), ...(seat === picked ? [GAGI_HAND[seat]] : [])],
      hand: [...(seat === picked || seat === "p0" ? [] : [GAGI_HAND[seat]]), GAGI_DECK[seat]],
    };
  }
  return defineScenario({
    id: `gaps-r1-${format}-gagigobyte-random-discard-of-the-picked-opponent-then-everyone-draws`,
    title: `${labelOf(format)}: p0 Special Summons Gagigobyte and picks ${picked}: only the hand card of ${picked} is discarded, then every duelist draws 1 card; the other opponent keeps its hand card`,
    source: GAGI_RULE,
    rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "gaps-r1", "r1", "opp-pick", "random", "draw", format, "card:74426895"],
    seed: ["1", seedWord, "3", "4"],
    setup,
    steps: [
      specialSummon(GAGI, "p0"),
      select(MEISEI, HYOSUBE),
      zone("p0", "m2", "p0"),
      yes("p0"),
      expectPickSeats(picks, "p0"),
      pickOpponent(picked, "p0"),
      everySeat(format, spec),
    ],
  });
}

export const GAPS_R1_SCENARIOS: Scenario[] = [
  gagigobyte("ffa3", "1"),
  gagigobyte("tag", "1"),
  grapha("ffa3"),
  grapha("tag"),
  ...([2, 4, 5] as const).flatMap((die) => [dangerousMachine("ffa3", die), dangerousMachine("tag", die)]),
];
