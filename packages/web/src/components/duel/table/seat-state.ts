import type { DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
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

/**
 * The living seat that plays after `seat`: eliminated and leaving seats are skipped (a leaving seat never plays
 * again). Null when no other seat is living. `seat` itself may be out.
 */
export function nextLivingSeat(seats: readonly SeatLike[], seat: number): number | null {
  const ordered = [...seats].sort((a, b) => a.seat - b.seat);
  const start = ordered.findIndex((entry) => entry.seat === seat);
  if (start < 0) return null;
  for (let step = 1; step < ordered.length; step += 1) {
    const candidate = ordered[(start + step) % ordered.length];
    if (!isOut(candidate)) return candidate.seat;
  }
  return null;
}

export function seatsOut(engine: Pick<DuelEngineView, "seats">): number[] {
  return engine.seats.filter((view) => isOut(view)).map((view) => view.seat);
}

/**
 * The seats that have left the duel, as groups in the order they left. Seats that go out in the same update are one
 * group and share a place. `before` is what was known; seats that are new since then form one group on the end. The engine
 * sends no elimination event, so a shell that opens on a table with seats already out cannot know their order: it
 * gets them as one group, unless the caller knows better (`initialOutOrder`).
 */
export function trackOutOrder(before: readonly (readonly number[])[], engine: Pick<DuelEngineView, "seats">): number[][] {
  const out = engine.seats.filter((view) => isEliminated(view)).map((view) => view.seat);
  const kept = before.map((group) => group.filter((seat) => out.includes(seat))).filter((group) => group.length > 0);
  const known = new Set(kept.flat());
  const added = out.filter((seat) => !known.has(seat));
  const unchanged = added.length === 0 && kept.length === before.length && kept.every((group, at) => group.length === before[at].length);
  return unchanged ? (before as number[][]) : added.length > 0 ? [...kept, added] : kept;
}

/**
 * The LP a seat lost in its newest "damage" event, for the red chip on its panel. Null when that event healed it
 * (the struck-out old value would be wrong then) or the seat took none in the event window.
 */
export function lastSeatDamage(events: DuelEngineView["events"], seat: number): number | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.kind !== "damage" || event.seat !== seat || event.amount == null || event.amount === 0) continue;
    return event.amount > 0 ? event.amount : null;
  }
  return null;
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
 * the seats that left, the last group out first. Seats that left together, or whose order is unknown, share a place.
 */
export function placings(engine: Pick<DuelEngineView, "seats" | "result">, outOrder: readonly (readonly number[])[] = []): Placing[] {
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
    const at = outOrder.findIndex((group) => group.includes(seat));
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

// The engine view has no first-attack-turn metadata. Keep the current engine's format gates here.
// TODO(R-FFA-NO-ATTACK): use FFA3 turn 3 / FFA4 turn 4 when the pending engine rule lands,
// or consume its first-attack-turn metadata when exposed. The UI must not advertise an unavailable phase.
const FIRST_ATTACK_TURN: ReadonlyMap<string, number> = new Map([
  ["1v1", 2], ["tag", 4], ["ffa3", 4], ["ffa4", 5],
]);

/** Current format fallback when the engine has not yet offered Battle Phase. */
export function firstAttackTurn(format: string | undefined, seatCount: number): number {
  return FIRST_ATTACK_TURN.get(format ?? "") ?? (seatCount > 2 ? seatCount + 1 : 2);
}

export interface AttackLock {
  firstTurn: number;
  turnsLeft: number;
}
/** Set while attacks are still shut at `turn`; null once they are open. */
export function attackLockAt(format: string | undefined, seatCount: number, turn: number | null | undefined, prompt?: DuelPrompt | null): AttackLock | null {
  if (turn == null) return null;
  // An authoritative phase offer takes precedence over the fallback table.
  if (prompt?.context?.type === "action" && prompt.options.some((option) => option.id === "to_bp")) return null;
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

/**
 * The seats in turn order, each with its tone and standing, for the strip in the station track. The seat that plays
 * after the turn seat reads "next" (a live seat that is not choosing).
 */
export function seatStrip(
  layout: TableLayout,
  engine: Pick<DuelEngineView, "turnSeat" | "seats">,
  promptSeat: number | null,
  nameOf: (seat: number) => string,
): SeatStripEntry[] {
  const next = nextLivingSeat(engine.seats, engine.turnSeat);
  return [...layout.slots]
    .sort((a, b) => a.turnOrder - b.turnOrder)
    .map((slot) => {
      const view = engine.seats.find((entry) => entry.seat === slot.seat);
      const status: SeatStatus = view?.eliminated ? "eliminated" : view?.pendingElimination ? "leaving"
        : promptSeat === slot.seat ? "choosing" : engine.turnSeat === slot.seat ? "turn" : next === slot.seat ? "next" : "active";
      return { seat: slot.seat, name: nameOf(slot.seat), tone: slot.tone, you: slot.seat === layout.viewerSeat, status };
    });
}

/** The tone of each seat, by seat number. */
export function toneBySeat(layout: TableLayout): Map<number, SeatTone> {
  return new Map(layout.slots.map((slot) => [slot.seat, slot.tone]));
}
