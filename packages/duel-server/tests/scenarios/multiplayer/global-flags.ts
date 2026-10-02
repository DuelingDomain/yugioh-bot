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

import {
  activate, attack, auto, changePhase, defineScenario, endTurn, expectBoard, yes, type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const SEATS: Record<Format, Seat[]> = { ffa3: ["p0", "p1", "p2"], ffa4: ["p0", "p1", "p2", "p3"], tag: ["p0", "p1", "p2", "p3"] };

const LAST_WILL = "Last Will";
const LAST_WILL_CODE = 85602018;
const RAT = "Giant Rat"; // 1400 ATK
const OX = "Battle Ox"; // 1700 ATK
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

/**
 * p1 attacks the Battle Ox of the next seat with its Giant Rat in its own turn: the Rat is destroyed and goes to its Graveyard, so a monster that
 * p1 controlled was sent to the GY this turn. p1 then activates Last Will in its Main Phase 2 and takes the Special Summon from its Deck.
 */
function lastWill(format: Format): Scenario {
  const target: Seat = "p2";
  const tag = format === "tag";
  const base = tag ? 16000 : 8000;
  const setup: Record<string, unknown> = { format, attackFirstTurn: true, p1: { monsters: [RAT], hand: [LAST_WILL] }, [target]: { monsters: [OX] } };
  for (const seat of SEATS[format]) if (!(seat in setup)) setup[seat] = {};
  return defineScenario({
    id: `global-flags-${format}-last-will-of-p1-sees-its-monster-sent-to-the-graveyard`,
    title: `${tag ? "Tag" : format.toUpperCase()}: Last Will of p1 gets its flag from the global check when the Giant Rat of p1 is destroyed in the turn of p1, so the Special Summon from the Deck is offered`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global check of a card writes the flag of every living duelist`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, `card:${LAST_WILL_CODE}`],
    setup: setup as Scenario["setup"],
    steps: [
      endTurn("p0"),
      attack(RAT, OX, "p1"),
      changePhase("main2", "p1"),
      activate(LAST_WILL, "p1"),
      // The flag of p1 is set, so the card asks if p1 wants the Special Summon (without the flag it would only set a delayed effect and ask nothing).
      yes("p1"),
      auto("p1"),
      // Battle Ox (1700) beats Giant Rat (1400): the Rat is in the GY of p1, p1 takes 300. The Elf of the Deck is Special Summoned to the field of p1.
      everySeat(format, {
        p1: { lp: base - 300, monsters: [ELF], grave: [RAT, LAST_WILL] },
        [target]: { monsters: [OX] },
      }),
    ],
  });
}

export const GLOBAL_FLAG_SCENARIOS: Scenario[] = [lastWill("ffa3"), lastWill("ffa4"), lastWill("tag")];
