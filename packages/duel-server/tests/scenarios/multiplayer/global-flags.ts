// Live scenarios of the cards that keep a per-player flag in a GLOBAL check (a continuous effect that the card registers in initial_effect for
// the literal player 0, here Last Will 85602018). Plain data: no Vitest import, so that scripts/rule-coverage.ts can load this file.
// global-flags.test.ts runs them on a live core (NSEAT_LIVE=1) with the real card scripts and the overlay.
//
// A global effect has no scope player, so Duel.MPNthDuelist gives nothing there. The overlay of these cards loops over the duelists with
// aux.MPEachSeat (mp-utility.lua), which reads the real seats in a global effect. With aux.MPForEachDuelist the loop ran zero times, no flag
// was written, and the holder never got the condition of the card at 3 or more seats.
//
// Last Will: "Activate only if a monster that you controlled was sent from the field to the Graveyard this turn: Special Summon 1 monster
// with 1500 ATK or less from your Deck". The flag of a duelist is set when a monster that it controlled leaves the field for the GY.
// Last Will writes the flag itself in a loop (aux.MPEachSeat). The cases: the holder is p1, a later seat (p2, p3), a negative case (the
// monster of the holder survives, so no flag and no Special Summon), and a seat that is out of the duel with LP left (it must not break the loop).
//
// Thunder Ball (84813516) stands for the 19 cards of the other form: the stock script registers the flag for the literal player 0 and the
// overlay wraps Duel.RegisterEffect, so that the operation of the global effect writes the flag of EVERY seat (a team in Tag, one flag per team).
// A battle between two OTHER seats must give the flag to a holder at seat 2 or 3. Thunder Ball and Last Will are put in the hand by setup: the
// scenarios prove the engine rule, not a legal deck.

import {
  activate, attack, auto, changePhase, defineScenario, eliminate, endTurn, expectBoard, expectEliminated, expectPrompt, yes,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const SEATS: Record<Format, Seat[]> = { ffa3: ["p0", "p1", "p2"], ffa4: ["p0", "p1", "p2", "p3"], tag: ["p0", "p1", "p2", "p3"] };

const LAST_WILL = "Last Will";
const LAST_WILL_CODE = 85602018;
const RAT = "Giant Rat"; // 1400 ATK
const OX = "Battle Ox"; // 1700 ATK
const THUNDER_BALL = "Thunder Ball";
const THUNDER_BALL_CODE = 84813516;
const ELF = "Mystical Elf"; // 800 ATK: the filler card of every Deck

/** The state of EVERY seat: monsters, Spell and Trap zones, Graveyard and banished zone are exact (a seat that the spec leaves out is empty). */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  const partner: Record<Seat, Seat> = { p0: "p2", p1: "p3", p2: "p0", p3: "p1" };
  for (const seat of SEATS[format]) {
    const lp = format === "tag" ? (spec[seat]?.lp ?? spec[partner[seat]]?.lp ?? 16000) : (spec[seat]?.lp ?? 8000);
    board[seat] = { monsters: [], spells: [], grave: [], banished: [], ...spec[seat], lp };
  }
  return expectBoard(board);
}

/** The seat after `seat` in the turn order of the table (a later seat of the same table; in Tag it is an opponent of every seat). */
function nextSeat(format: Format, seat: Seat): Seat {
  const order = SEATS[format];
  return order[(order.indexOf(seat) + 1) % order.length]!;
}

/** The End Phases of the seats before `holder` in the turn order (their turns pass with no action). */
function turnsBefore(format: Format, holder: Seat): Step[] {
  return SEATS[format].slice(0, SEATS[format].indexOf(holder)).map((seat) => endTurn(seat));
}

function baseSetup(format: Format, setup: Partial<Record<Seat, object>>): Scenario["setup"] {
  const full: Record<string, unknown> = { format, attackFirstTurn: true, ...setup };
  for (const seat of SEATS[format]) if (!(seat in full)) full[seat] = {};
  return full as Scenario["setup"];
}

const label = (format: Format) => (format === "tag" ? "Tag" : format.toUpperCase());

/**
 * `holder` attacks the Battle Ox of the next seat with its Giant Rat in its own turn: the Rat is destroyed and goes to its Graveyard, so a
 * monster that `holder` controlled was sent to the GY this turn. `holder` then activates Last Will in its Main Phase 2 and takes the Special
 * Summon from its Deck. With `out` a seat that is out of the duel (with the LP it had) sits at the table: the loop must still work.
 */
function lastWill(format: Format, holder: Seat = "p1", out?: Seat): Scenario {
  const target = nextSeat(format, holder);
  const base = format === "tag" ? 16000 : 8000;
  const dead = out ? { [out]: { lp: base } } : {};
  const suffix = out ? `-while-${out}-is-out` : "";
  return defineScenario({
    id: `global-flags-${format}-last-will-of-${holder}-sees-its-monster-sent-to-the-graveyard${suffix}`,
    title: `${label(format)}: Last Will of ${holder} gets its flag from the global check when the Giant Rat of ${holder} is destroyed in the turn of ${holder}, so the Special Summon from the Deck is offered${out ? ` (${out} is out of the duel with its LP left)` : ""}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global check of a card writes the flag of every living duelist`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, `card:${LAST_WILL_CODE}`],
    setup: baseSetup(format, { [holder]: { monsters: [RAT], hand: [LAST_WILL] }, [target]: { monsters: [OX] } }),
    steps: [
      ...(out ? [eliminate(out)] : []),
      ...turnsBefore(format, holder).filter((step) => !(out && step.op === "phase" && step.by === out)),
      attack(RAT, OX, holder),
      changePhase("main2", holder),
      activate(LAST_WILL, holder),
      // The flag of the holder is set, so the card asks if it wants the Special Summon (without the flag it would only set a delayed effect and ask nothing).
      yes(holder),
      auto(holder),
      // Battle Ox (1700) beats Giant Rat (1400): the Rat is in the GY of the holder, it takes 300. The Elf of the Deck is Special Summoned to its field.
      ...(out ? [expectEliminated(out)] : []),
      everySeat(format, {
        ...dead,
        [holder]: { lp: base - 300, monsters: [ELF], grave: [RAT, LAST_WILL] },
        [target]: { monsters: [OX] },
      }),
    ],
  });
}

/**
 * Negative case: the Battle Ox of `holder` destroys the Giant Rat of the next seat. The monster of `holder` stays on the field, so `holder` has
 * no flag: Last Will asks no 'Special Summon?' when it is activated in Main Phase 2, the Special Summon does not happen, and every seat keeps what it had.
 */
function lastWillWithoutLoss(format: Format, holder: Seat): Scenario {
  const target = nextSeat(format, holder);
  const base = format === "tag" ? 16000 : 8000;
  return defineScenario({
    id: `global-flags-${format}-last-will-of-${holder}-has-no-flag-when-only-an-opponent-monster-is-destroyed`,
    title: `${label(format)}: Last Will of ${holder} asks for no Special Summon when the Battle Ox of ${holder} destroys the Giant Rat of ${target} (no monster of ${holder} left the field)`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global check of a card writes the flag of the duelist that controlled the monster, no other`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, `card:${LAST_WILL_CODE}`],
    setup: baseSetup(format, { [holder]: { monsters: [OX], hand: [LAST_WILL] }, [target]: { monsters: [RAT] } }),
    steps: [
      ...turnsBefore(format, holder),
      attack(OX, RAT, holder),
      changePhase("main2", holder),
      activate(LAST_WILL, holder),
      // Without the flag the card asks nothing (with it, it asks "Special Summon?"): the next prompt is the plain action prompt of Main Phase 2.
      expectPrompt({ by: holder, context: "action", offers: ["to_ep"] }),
      // The Rat of the next seat is in its GY and that seat takes 300. The holder keeps the Ox, Last Will is in its GY, and no monster was Special Summoned.
      everySeat(format, {
        [holder]: { monsters: [OX], grave: [LAST_WILL] },
        [target]: { lp: base - 300, grave: [RAT] },
      }),
    ],
  });
}

/**
 * The wrapped form (Thunder Ball): p0 attacks the Giant Rat of p1 with its Battle Ox in its own turn. The global check of the card writes its
 * flag at EVENT_BATTLED, and at the end of the Damage Step the card in the hand of `holder` (a seat that took no part in the battle) asks to
 * Special Summon itself: its condition reads the flag of the holder. The Rat of p1 is destroyed and p1 (its team in Tag) takes 300.
 */
function thunderBall(format: Format, holder: Seat): Scenario {
  const base = format === "tag" ? 16000 : 8000;
  return defineScenario({
    id: `global-flags-${format}-thunder-ball-of-${holder}-sees-a-battle-between-other-seats`,
    title: `${label(format)}: Thunder Ball in the hand of ${holder} gets the flag of the global check from a battle between p0 and p1 and is Special Summoned at the end of the Damage Step`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global check of a card writes the flag of every living duelist (the wrapped form)`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, `card:${THUNDER_BALL_CODE}`],
    setup: baseSetup(format, { p0: { monsters: [OX] }, p1: { monsters: [RAT] }, [holder]: { hand: [THUNDER_BALL] } }),
    steps: [
      attack(OX, RAT, "p0"),
      activate(THUNDER_BALL, holder),
      auto(holder),
      everySeat(format, {
        p0: { monsters: [OX] },
        p1: { lp: base - 300, grave: [RAT] },
        [holder]: { monsters: [THUNDER_BALL] },
      }),
    ],
  });
}

export const GLOBAL_FLAG_SCENARIOS: Scenario[] = [
  lastWill("ffa3"), lastWill("ffa4"), lastWill("tag"),
  lastWill("ffa3", "p2"), lastWill("ffa4", "p3"), lastWill("tag", "p2"), lastWill("tag", "p3"),
  lastWill("ffa4", "p1", "p3"),
  lastWillWithoutLoss("ffa3", "p2"), lastWillWithoutLoss("ffa4", "p3"), lastWillWithoutLoss("tag", "p2"),
  thunderBall("ffa3", "p2"), thunderBall("ffa4", "p3"), thunderBall("tag", "p2"), thunderBall("tag", "p3"),
];
