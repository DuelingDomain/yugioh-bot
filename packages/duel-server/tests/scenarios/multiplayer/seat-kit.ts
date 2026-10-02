// Small helpers that the cross-area scenario files share (plain data helpers: no Vitest import, so that scripts/rule-coverage.ts can load
// the files that use them). global-flags.ts keeps its own copies of the first four.

import { expectBoard, type BoardExpect, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";

export type Seat = "p0" | "p1" | "p2" | "p3";
export type Format = "ffa3" | "ffa4" | "tag";

export const SEATS: Record<Format, Seat[]> = { ffa3: ["p0", "p1", "p2"], ffa4: ["p0", "p1", "p2", "p3"], tag: ["p0", "p1", "p2", "p3"] };
export const PARTNER: Record<Seat, Seat> = { p0: "p2", p1: "p3", p2: "p0", p3: "p1" };

export const label = (format: Format): string => (format === "tag" ? "Tag" : format.toUpperCase());
export const baseLp = (format: Format): number => (format === "tag" ? 16000 : 8000);

/** The state of EVERY seat: monsters, Spell and Trap zones, Graveyard and banished zone are exact (a seat that the spec leaves out is empty). */
export function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  for (const seat of SEATS[format]) {
    const lp = format === "tag" ? (spec[seat]?.lp ?? spec[PARTNER[seat]]?.lp ?? 16000) : (spec[seat]?.lp ?? 8000);
    board[seat] = { monsters: [], spells: [], grave: [], banished: [], ...spec[seat], lp };
  }
  return expectBoard(board);
}

/** The End Phases of the seats before `holder` in the turn order (their turns pass with no action). */
export function turnsBefore(format: Format, holder: Seat, from: Seat = "p0"): Step[] {
  const order = SEATS[format];
  return order.slice(order.indexOf(from), order.indexOf(holder)).map((seat) => ({ op: "phase", to: "end", by: seat }) as Step);
}

/** Full setup: the format, attackFirstTurn, and an empty setup for every seat that the spec leaves out. */
export function baseSetup(format: Format, setup: Partial<Record<Seat, object>>): Scenario["setup"] {
  const full: Record<string, unknown> = { format, attackFirstTurn: true, ...setup };
  for (const seat of SEATS[format]) if (!(seat in full)) full[seat] = {};
  return full as Scenario["setup"];
}
