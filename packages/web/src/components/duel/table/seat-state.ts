import type { DuelEngineView } from "@yugidraft/shared/duels";
import { isEliminated } from "../multi-seat";
import type { SeatStatus, SeatTone, TableLayout } from "./types";

/**
 * Pure seat facts of a table: who is out, who stands where when the duel ends, the seat strip of the station
 * track and the "no attack yet" rule. The shell and the components read these; nothing here touches the DOM.
 */

type SeatLike = Pick<DuelEngineView["seats"][number], "seat" | "lp" | "eliminated" | "pendingElimination">;
type EngineLike = Pick<DuelEngineView, "turn" | "turnSeat" | "seats" | "result" | "format">;

/** True when the seat has left the duel, or is about to (its loss waits for the open prompt). */
export function isOut(view: SeatLike | undefined): boolean {
  return view != null && (view.eliminated === true || view.pendingElimination === true);
}

export function seatsOut(engine: Pick<DuelEngineView, "seats">): number[] {
  return engine.seats.filter((view) => isOut(view)).map((view) => view.seat);
}

/** The seats that have left the duel, in the order they left. `before` is what was known; new seats go on the end. */
export function trackOutOrder(before: readonly number[], engine: Pick<DuelEngineView, "seats">): number[] {
  const out = engine.seats.filter((view) => isEliminated(view)).map((view) => view.seat);
  const kept = before.filter((seat) => out.includes(seat));
  const added = out.filter((seat) => !kept.includes(seat));
  return added.length === 0 && kept.length === before.length ? (before as number[]) : [...kept, ...added];
}

export interface Placing {
  seat: number;
  /** 1 is the winner. Seats that left together share a place. */
  place: number;
  lp: number;
  winner: boolean;
}

/**
 * The final standing of every seat. Winners share place 1. Seats still in the duel come next (more LP first), then
 * the seats that left, the last one out first. Seats with no known order of leaving share a place.
 */
export function placings(engine: Pick<DuelEngineView, "seats" | "result">, outOrder: readonly number[] = []): Placing[] {
  const winners = new Set<number>();
  const result = engine.result;
  if (result) {
    if (result.winnerSeat != null) winners.add(result.winnerSeat);
    if (result.winnerTeam != null) for (const view of engine.seats) if (view.team === result.winnerTeam) winners.add(view.seat);
  }
  const rank = (seat: number): number => {
    if (winners.has(seat)) return 0;
    const view = engine.seats.find((entry) => entry.seat === seat);
    if (view?.eliminated !== true) return 1;
    const at = outOrder.indexOf(seat);
    return at < 0 ? 2 : 3 + (outOrder.length - at);
  };
  const sorted = [...engine.seats].sort((a, b) => {
    const diff = rank(a.seat) - rank(b.seat);
    if (diff !== 0) return diff;
    if (rank(a.seat) === 1) return b.lp - a.lp || a.seat - b.seat;
    return a.seat - b.seat;
  });
  const rows: Placing[] = [];
  sorted.forEach((view, index) => {
    const before = rows[index - 1];
    const same = before != null && rank(before.seat) === rank(view.seat) && (rank(view.seat) !== 1 || before.lp === view.lp);
    rows.push({ seat: view.seat, place: same ? before.place : index + 1, lp: view.lp, winner: winners.has(view.seat) });
  });
  return rows;
}

export function placeLabel(place: number): string {
  const tail = place % 100;
  if (tail >= 11 && tail <= 13) return `${place}th`;
  return `${place}${["th", "st", "nd", "rd"][place % 10 <= 3 ? place % 10 : 0]}`;
}

/** The turn from which attacks are legal: Tag turn 4, a table of n duelists turn n + 1, a duel of two turn 2. */
export function firstAttackTurn(format: string | undefined, seatCount: number): number {
  if (format === "tag") return 4;
  return seatCount > 2 ? seatCount + 1 : 2;
}

export interface AttackLock {
  firstTurn: number;
  turnsLeft: number;
}
/** Set while attacks are still shut at `turn`; null once they are open. */
export function attackLockAt(format: string | undefined, seatCount: number, turn: number | null | undefined): AttackLock | null {
  if (turn == null) return null;
  const firstTurn = firstAttackTurn(format, seatCount);
  return turn < firstTurn ? { firstTurn, turnsLeft: firstTurn - turn } : null;
}

export interface SeatStripEntry {
  seat: number;
  name: string;
  tone: SeatTone;
  you: boolean;
  status: SeatStatus;
}

/** The seats in turn order, each with its tone and standing, for the strip in the station track. */
export function seatStrip(
  layout: TableLayout,
  engine: Pick<DuelEngineView, "turnSeat" | "seats">,
  promptSeat: number | null,
  nameOf: (seat: number) => string,
): SeatStripEntry[] {
  return [...layout.slots]
    .sort((a, b) => a.turnOrder - b.turnOrder)
    .map((slot) => {
      const view = engine.seats.find((entry) => entry.seat === slot.seat);
      const status: SeatStatus = view?.eliminated ? "eliminated" : view?.pendingElimination ? "leaving"
        : promptSeat === slot.seat ? "choosing" : engine.turnSeat === slot.seat ? "turn" : "active";
      return { seat: slot.seat, name: nameOf(slot.seat), tone: slot.tone, you: slot.seat === layout.viewerSeat, status };
    });
}

/** The tone of each seat, by seat number. */
export function toneBySeat(layout: TableLayout): Map<number, SeatTone> {
  return new Map(layout.slots.map((slot) => [slot.seat, slot.tone]));
}
