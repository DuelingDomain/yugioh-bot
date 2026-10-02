// Live scenarios of the R1 cards that the Table test listed as known gaps (Grapha, Dangerous Machine Type-6) and of the R1 stock parts that
// were checked against the owner rules (Q3 each duelist, R-COMMON-OPP-PICK). Plain data, also read by scripts/rule-coverage.ts;
// gaps-r1.test.ts runs it on a live core (NSEAT_LIVE=1), on the Standard multi core and again on the Domain multi core. Every scenario uses
// the real card scripts plus the overlay, and ends with the state of EVERY seat (LP, field, hand, GY, banished zone).

import {
  activate, choose, defineScenario, endTurn, expectBoard, expectLog, expectNoLog, expectPickSeats, no, pickOpponent, select, specialSummon, xyz, yes, zone,
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
const JORMUNGANDR = "Jormungandr, Generaider Boss of Eternity";

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
    ...(format !== "ffa3" ? { p3: { hand: [FANG] } } : {}),
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
        ...(format !== "ffa3" ? { p3: { hand: [FANG] } } : {}),
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
const MACHINE_PICKS: Record<Format, Seat[]> = { ffa3: ["p1", "p2"], ffa4: ["p1", "p2", "p3"], tag: ["p1", "p3"] };
const MACHINE_SEEDS = { 2: "3494825834153508910", 4: "3718197871008284709", 5: "4388313981572612106" } as const;
const MACHINE_HAND: Record<Seat, string> = { p0: RAT, p1: OX, p2: FANG, p3: ELF };
const MACHINE_FIELD: Record<Seat, string> = { p0: ELF, p1: AXE, p2: RAT, p3: OX };
const MACHINE_DECK: Record<Seat, string> = { p0: OX, p1: AXE, p2: ELF, p3: RAT };

function dangerousMachine(format: Format, die: 2 | 4 | 5): Scenario {
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
  const start = structuredClone(spec);
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
    // The pick comes BEFORE the die: while the pick is open no die was rolled and no seat has changed; the die is logged only after the pick.
    steps: [
      expectPickSeats(MACHINE_PICKS[format], "p0"), expectNoLog("Dice roll"), everySeat(format, start),
      pickOpponent(picked, "p0"), expectLog(`Dice roll: ${die}`),
      ...(die === 5 ? [select({ card: MACHINE_FIELD.p1, owner: "p1" })] : []), everySeat(format, spec),
    ],
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

// --- Number 63: Shamoji Soldier -----------------------------------------------------------------------------------------------------------
// Detach 1 material, then choose: (option 1) in the Standby Phase of the next turn of an opponent both players draw 1 card, or (option 2) both
// players gain 1000 LP. "Both players" is every duelist (R-COMMON-EACH-PLAYER, the Tag partner too). The delayed draw waits for the first turn
// of any opponent (Q1, rule R3): the effect fires once in the Standby Phase of p1 (the first opponent clockwise; in Tag the partner p2 is not an
// opponent) and every duelist draws once. It is gone after that turn: the Standby Phase of the next duelist draws nothing extra.
const SHAMOJI = "Number 63: Shamoji Soldier";
const SHAMOJI_RULE = `${SOURCE} [R-COMMON-EACH-PLAYER], card decisions 2026-10-01 Q1/Q3: Number 63: Shamoji Soldier (the delayed draw of every duelist in the Standby Phase of the first opponent turn)`;
const SHAMOJI_HAND: Record<Seat, string> = { p0: RAT, p1: OX, p2: AXE, p3: FANG };
const SHAMOJI_DECK: Record<Seat, string> = { p0: ELF, p1: RAT, p2: OX, p3: AXE };

function shamoji(format: "ffa3" | "tag", choice: "draw" | "lp"): Scenario {
  const seats = seatsOf(format);
  const tag = format === "tag";
  const setup: Scenario["setup"] = { format };
  for (const seat of seats) {
    (setup as Record<string, unknown>)[seat] = {
      hand: [SHAMOJI_HAND[seat]],
      deck: [SHAMOJI_DECK[seat], SHAMOJI_DECK[seat], SHAMOJI_DECK[seat]],
      ...(seat === "p0" ? { monsters: [{ card: SHAMOJI, materials: [AXE] }] } : {}),
    };
  }
  const base = (seat: Seat): DuelistExpect => ({ ...(seat === "p0" ? { monsters: [SHAMOJI], grave: [AXE] } : {}), hand: [SHAMOJI_HAND[seat]] });
  const steps: Step[] = [activate(SHAMOJI, "p0"), choose(choice === "draw" ? "opt:0" : "opt:1", "p0")];
  if (choice === "lp") {
    const spec: Partial<Record<Seat, DuelistExpect>> = {};
    for (const seat of seats) spec[seat] = { ...base(seat), lp: (tag ? 16000 : 8000) + (tag ? 2000 : 1000) };
    steps.push(everySeat(format, spec, tag ? 18000 : 9000));
  } else {
    // Nothing is drawn yet in the turn of p0. Then p0 ends the turn: in the Standby Phase of p1 every duelist draws 1, once.
    const now: Partial<Record<Seat, DuelistExpect>> = {};
    for (const seat of seats) now[seat] = base(seat);
    steps.push(everySeat(format, now), endTurn("p0"));
    const after: Partial<Record<Seat, DuelistExpect>> = {};
    for (const seat of seats) after[seat] = { ...base(seat), hand: [SHAMOJI_HAND[seat], SHAMOJI_DECK[seat], ...(seat === "p1" ? [SHAMOJI_DECK[seat]] : [])] };
    steps.push(everySeat(format, after), endTurn("p1"));
    // The effect is gone after the turn of p1: the next duelist (p2, in Tag the partner of p0) makes its normal draw only, so p2 holds the effect
    // draw and the normal draw, and nobody else draws again.
    const next: Partial<Record<Seat, DuelistExpect>> = {};
    for (const seat of seats) next[seat] = { ...after[seat], hand: [...(after[seat]?.hand as string[]), ...(seat === "p2" ? [SHAMOJI_DECK[seat]] : [])] };
    steps.push(everySeat(format, next));
  }
  return defineScenario({
    id: `gaps-r1-${format}-shamoji-soldier-${choice === "draw" ? "delayed-draw-of-every-duelist-in-the-first-opponent-standby-phase" : "every-duelist-gains-1000-lp"}`,
    title: choice === "draw"
      ? `${labelOf(format)}: p0 detaches 1 material of Shamoji Soldier and chooses the delayed draw: nothing is drawn in the turn of p0, then in the Standby Phase of p1 every duelist draws 1 card once (p1 also made its normal draw)`
      : `${labelOf(format)}: p0 detaches 1 material of Shamoji Soldier and chooses the LP gain: every duelist gains 1000 LP${tag ? " (each team gains 2000, the partner included)" : ""}`,
    source: SHAMOJI_RULE,
    rules: ["R-COMMON-EACH-PLAYER", ...(tag ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "gaps-r1", "r1", "each-player", "delayed", format, "card:89642993"],
    setup,
    steps,
  });
}

// Dark Scheme is a Trap card: it is set on the field of p0 at the start of the scenario.
// --- Dark Scheme -------------------------------------------------------------------------------------------------------------------------
// "Each player discards 2 cards and draws 2 cards. Before that, your opponent may discard 1 card to negate this effect." Every duelist
// takes part in the discard and the draw (Q3). The word "opponent" is singular, so ONE opponent decides (Q5): p0 picks it when it activates the
// card, and only that duelist is asked; the other opponent and the Tag partner are never asked. The last opponent is picked, never p1.
const SCHEME = "Dark Scheme";
const SCHEME_RULE = `${SOURCE} [R-COMMON-OPP-PICK], card decisions 2026-10-01 Q3/Q5: Dark Scheme (ONE picked opponent may discard 1 card to negate; every duelist discards 2 and draws 2)`;
const SCHEME_HAND: Record<Seat, [string, string]> = { p0: [RAT, OX], p1: [AXE, FANG], p2: [ELF, RAT], p3: [OX, AXE] };
const SCHEME_DECK: Record<Seat, string> = { p0: FANG, p1: ELF, p2: OX, p3: RAT };

function darkScheme(format: Format, negate: boolean): Scenario {
  const seats = seatsOf(format);
  const tag = format === "tag";
  const picks: Seat[] = tag ? ["p1", "p3"] : format === "ffa4" ? ["p1", "p2", "p3"] : ["p1", "p2"];
  const picked = picks[picks.length - 1];
  const setup: Scenario["setup"] = { format };
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    (setup as Record<string, unknown>)[seat] = {
      hand: [...SCHEME_HAND[seat]],
      deck: [SCHEME_DECK[seat], SCHEME_DECK[seat], SCHEME_DECK[seat]],
      ...(seat === "p0" ? { spells: [{ card: SCHEME, pos: "set" }] } : {}),
    };
    if (negate) {
      // Only the picked opponent discards 1 card (its first card); the effect is negated: nobody discards 2 and nobody draws.
      spec[seat] = {
        hand: seat === picked ? [SCHEME_HAND[seat][1]] : [...SCHEME_HAND[seat]],
        grave: [...(seat === "p0" ? [SCHEME] : []), ...(seat === picked ? [SCHEME_HAND[seat][0]] : [])],
      };
    } else {
      // Nobody negates: every duelist (the partner too) discards its 2 cards and draws 2 cards.
      spec[seat] = {
        hand: [SCHEME_DECK[seat], SCHEME_DECK[seat]],
        grave: [...(seat === "p0" ? [SCHEME] : []), ...SCHEME_HAND[seat]],
      };
    }
  }
  const steps: Step[] = [activate(SCHEME, "p0"), expectPickSeats(picks, "p0"), pickOpponent(picked, "p0")];
  steps.push(negate ? yes(picked) : no(picked));
  if (negate) steps.push(select({ card: SCHEME_HAND[picked][0], owner: picked }));
  steps.push(everySeat(format, spec));
  return defineScenario({
    id: `gaps-r1-${format}-dark-scheme-${negate ? "the-picked-opponent-discards-1-and-negates" : "the-picked-opponent-declines-everyone-discards-2-and-draws-2"}`,
    title: negate
      ? `${labelOf(format)}: p0 activates Dark Scheme and picks ${picked}: only ${picked} is asked, it discards 1 card and the effect is negated; nobody else is asked, discards or draws`
      : `${labelOf(format)}: p0 activates Dark Scheme and picks ${picked}: only ${picked} is asked and declines, so every duelist (the partner too) discards 2 cards and draws 2 cards`,
    source: SCHEME_RULE,
    rules: ["R-COMMON-OPP-PICK", ...(tag ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "gaps-r1", "r1", "opp-pick", "negate", "draw", format, "card:69402394"],
    setup,
    steps,
  });
}

// --- Jormungandr, Generaider Boss of Eternity --------------------------------------------------------------------------------------
// Detach 1 material: EVERY duelist draws 1 card, then every duelist that drew attaches 1 card of its own (hand or field) to Jormungandr (Q3).
// The material check is made for the CONTROLLER of Jormungandr (the stock check passes the effect tp), not for the duelist that attaches.
function jormungandr(format: Format): Scenario {
  const tag = format === "tag";
  const seats = seatsOf(format);
  const given: Record<Seat, string> = { p0: AXE, p1: OX, p2: FANG, p3: RAT };
  const setup: Record<string, unknown> = { format, p0: { hand: [AXE], monsters: [xyz(JORMUNGANDR, [ELF, ELF])] } };
  for (const seat of seats.slice(1)) setup[seat] = { hand: [given[seat]] };
  return defineScenario({
    id: `gaps-r1-${format}-jormungandr-every-duelist-draws-and-attaches-one-card`,
    title: `${labelOf(format)}: p0 detaches 1 material of Jormungandr: every duelist draws 1 card and attaches 1 card of its own to Jormungandr (${seats.length + 1} materials in all, ${tag ? "the partners p2 and p3 attach too" : "p1 and p2 attach too"})`,
    source: `${SOURCE} [R-COMMON-EACH-PLAYER]`,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "gaps-r1", format, "card:2665273"],
    setup: setup as unknown as Scenario["setup"],
    steps: [
      activate(JORMUNGANDR, "p0"),
      select({ card: ELF, nth: 0 }), // the cost: detach 1 of the 2 materials
      ...seats.map((seat) => select({ card: given[seat], owner: seat })),
      everySeat(format, { p0: { hand: [ELF], monsters: [JORMUNGANDR], grave: [ELF], zones: { m0: { card: JORMUNGANDR, materials: seats.length + 1 } } }, ...Object.fromEntries(seats.slice(1).map((seat) => [seat, { hand: [ELF] }])) }),
    ],
  });
}

export const GAPS_R1_SCENARIOS: Scenario[] = [
  darkScheme("ffa3", false),
  darkScheme("ffa4", false),
  darkScheme("tag", false),
  darkScheme("ffa3", true),
  darkScheme("ffa4", true),
  darkScheme("tag", true),
  shamoji("ffa3", "lp"),
  shamoji("tag", "lp"),
  shamoji("ffa3", "draw"),
  shamoji("tag", "draw"),
  gagigobyte("ffa3", "1"),
  gagigobyte("tag", "1"),
  grapha("ffa3"),
  grapha("ffa4"),
  grapha("tag"),
  jormungandr("ffa3"),
  jormungandr("tag"),
  ...([2, 4, 5] as const).flatMap((die) => [dangerousMachine("ffa3", die), dangerousMachine("ffa4", die), dangerousMachine("tag", die)]),
];
