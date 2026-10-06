import { seatCountFor, type DuelEngineView, type DuelFormat, type SandboxRun } from "@yugidraft/shared/duels";
import type { Rule } from "./scripted-bot.js";

/** The host's HTTP error handler reads status from Error instances. */
export class SandboxSeatError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 409) {
    super(message);
    this.name = "SandboxSeatError";
  }
}

export interface ActingSeatOptions {
  /** True only when the persisted duel row is a sandbox. */
  sandbox: boolean;
  actor: number;
  organizerPlayerId: number;
  /** Database seat, before applying the requested override. */
  mySeat: number | null;
  format: DuelFormat;
  manualSeats: ReadonlySet<number>;
  /** Untrusted request value. Only an omitted value means no override. */
  as?: unknown;
}

/**
 * Ordinary duels keep their database seat and cannot accept an override.
 * Only the sandbox organizer can act; seat 0 is always manual. Other seats
 * must exist in the format and already be under manual control.
 * The web admin gate and reveal/control/restart authorization remain host duties.
 */
export function resolveActingSeat(options: ActingSeatOptions): number | null {
  if (!options.sandbox) {
    if (options.as !== undefined) throw new SandboxSeatError("Acting seat overrides require a sandbox duel", 409);
    return options.mySeat;
  }
  if (options.actor !== options.organizerPlayerId) {
    throw new SandboxSeatError("Only the sandbox organizer can access this duel", 403);
  }
  const seat = options.as === undefined ? options.mySeat ?? 0 : options.as;
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= seatCountFor(options.format)) {
    throw new SandboxSeatError("Choose a seat in this duel", 400);
  }
  if (seat !== 0 && !options.manualSeats.has(seat)) {
    throw new SandboxSeatError(`Take control of seat ${seat} first`, 409);
  }
  return seat;
}

/**
 * Call only after sandbox/organizer authorization, when reveal is enabled.
 * Each map entry must be [seat, await game.view(seat)] from the same revision.
 * Only that seat's hand and Extra Deck are copied. Prompts, logs, field cards,
 * chain modes, and all other fields stay in the acting seat's projection.
 * Missing views leave the original row unchanged. Neither input is mutated.
 */
export function mergeRevealedHands(
  view: DuelEngineView,
  seatViews: ReadonlyMap<number, DuelEngineView>,
): DuelEngineView {
  return {
    ...view,
    seats: view.seats.map((seat) => {
      const own = seatViews.get(seat.seat)?.seats.find((row) => row.seat === seat.seat);
      return own ? { ...seat, hand: [...own.hand], extra: [...own.extra] } : seat;
    }),
  };
}

/**
 * Build fresh live state from a parsed run on start, recovery, or control change.
 * Empty rules make the scripted bot pass. Practice seats have no policy entry.
 * manualSeats includes seat 0; autoSeatsOf must exclude every seat in that set.
 * Modes stored for seats outside this format are ignored.
 */
export function policiesForRun(
  run: SandboxRun,
  format: DuelFormat,
): { policies: Map<number, Rule[]>; manualSeats: Set<number> } {
  const policies = new Map<number, Rule[]>();
  const manualSeats = new Set<number>([0]);
  for (const key of ["1", "2", "3"] as const) {
    const seat = Number(key);
    if (seat >= seatCountFor(format)) continue;
    if (run.bots[key] === "pass") policies.set(seat, []);
    else if (run.bots[key] === "manual") manualSeats.add(seat);
  }
  return { policies, manualSeats };
}
