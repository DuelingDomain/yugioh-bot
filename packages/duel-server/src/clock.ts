import { DUEL_CLOCK_INCREMENT_MS, DUEL_OPENING_GRACE_MS, duelClockBankMs, duelClockRegainMs } from "@yugidraft/shared/duels";

export type SeatIndex = 0 | 1;

/** Matches shared `DuelClockState`; host persists this JSON, never live-subtracted remaining. */
export interface DecisionClockState {
  turn: number;
  remainingMs: [number, number];
  activeSeat: SeatIndex | null;
  startedAt: number | null;
}

export interface DecisionClockView {
  turn: number;
  promptSeat: number | null;
  /** The first engine snapshot of a new game, before any command was accepted. */
  opening?: boolean;
}

export interface PublicDecisionClock extends DecisionClockState {
  serverNow: number;
}

export function isSeatIndex(value: number | null | undefined): value is SeatIndex {
  return value === 0 || value === 1;
}

/** Time bank size (the cap for every seat). Rules constants live in shared `settings.ts`. */
export function clockBudgetMs(turnSeconds: number): number | null {
  return duelClockBankMs(turnSeconds);
}

function addCapped(current: number, add: number, cap: number): number {
  // A bank already above the cap (room settings changed, old row) is never cut down here.
  return Math.max(current, Math.min(cap, current + add));
}

export function liveRemainingMs(clock: DecisionClockState, now: number): [number, number] {
  const remaining: [number, number] = [
    Math.max(0, clock.remainingMs[0]),
    Math.max(0, clock.remainingMs[1]),
  ];
  if (clock.activeSeat === null || clock.startedAt === null) return remaining;
  const elapsed = Math.max(0, now - clock.startedAt);
  remaining[clock.activeSeat] = Math.max(0, remaining[clock.activeSeat] - elapsed);
  return remaining;
}

export function deadlineAt(clock: DecisionClockState): number | null {
  if (clock.activeSeat === null || clock.startedAt === null) return null;
  return clock.startedAt + Math.max(0, clock.remainingMs[clock.activeSeat]);
}

export function isClockDue(clock: DecisionClockState, now: number): boolean {
  const deadline = deadlineAt(clock);
  return deadline !== null && deadline <= now;
}

export function startDecisionClock(
  view: DecisionClockView,
  turnSeconds: number,
  now: number,
): DecisionClockState | null {
  const budget = clockBudgetMs(turnSeconds);
  if (budget === null) return null;
  const activeSeat = isSeatIndex(view.promptSeat) ? view.promptSeat : null;
  return {
    turn: view.turn,
    remainingMs: [budget, budget],
    activeSeat,
    startedAt: activeSeat === null ? null : now + (view.opening ? DUEL_OPENING_GRACE_MS : 0),
  };
}

/**
 * After an accepted engine command. Time bank rules:
 * - Freeze remaining at `decidedAt` (player commit) and start the next prompt owner at `resumeAt`,
 *   so engine processing is not charged. Only the answering seat is charged.
 * - The deciding seat gets `DUEL_CLOCK_INCREMENT_MS` back, capped at the bank. A seat already at
 *   zero (continue-timeout freeze) gets nothing until the next turn.
 * - When the duel turn changes, each seat regains `duelClockRegainMs` (25% of the bank, at least
 *   30 s), capped at the bank. Clocks saved before this rule simply follow it from their next turn.
 * Does not invent a clock when none was persisted.
 * Loss clocks that are already due keep their deadline; they are never rewritten into
 * a continue-style zero freeze (`startedAt: null`) that would disable timeout enforcement.
 */
export function syncDecisionClock(
  previous: DecisionClockState | null,
  view: DecisionClockView,
  turnSeconds: number,
  decidedAt: number,
  resumeAt: number = decidedAt,
  timeout: "loss" | "continue" = "continue",
  decidedSeat: SeatIndex | null | undefined = previous?.activeSeat,
): DecisionClockState | null {
  const budget = clockBudgetMs(turnSeconds);
  if (budget === null) return null;
  if (!previous) return null;
  if (timeout === "loss" && isClockDue(previous, decidedAt)) {
    const remaining = liveRemainingMs(previous, decidedAt);
    return {
      turn: previous.turn,
      remainingMs: remaining,
      activeSeat: previous.activeSeat,
      startedAt: previous.startedAt,
    };
  }
  const remaining = liveRemainingMs(previous, decidedAt);
  if (isSeatIndex(decidedSeat) && remaining[decidedSeat] > 0) {
    remaining[decidedSeat] = addCapped(remaining[decidedSeat], DUEL_CLOCK_INCREMENT_MS, budget);
  }
  if (previous.turn !== view.turn) {
    const regain = duelClockRegainMs(turnSeconds);
    remaining[0] = addCapped(remaining[0], regain, budget);
    remaining[1] = addCapped(remaining[1], regain, budget);
  }
  const nextSeat = isSeatIndex(view.promptSeat) ? view.promptSeat : null;
  // Reduced motion or a bot may answer during the opening grace. Keep its original end,
  // without granting another grace window on a prompt change or a reconnect.
  const startAt = Math.max(resumeAt, previous.startedAt ?? resumeAt);
  return {
    turn: view.turn,
    remainingMs: remaining,
    activeSeat: nextSeat,
    startedAt: nextSeat !== null && remaining[nextSeat] > 0 ? startAt : null,
  };
}

/** Continue timeout: remaining frozen at zero for the expired seat; not due again until the next turn (which regains time). */
export function freezeContinueClock(clock: DecisionClockState, now: number): DecisionClockState {
  return {
    turn: clock.turn,
    remainingMs: liveRemainingMs(clock, now),
    activeSeat: clock.activeSeat,
    startedAt: null,
  };
}

export function timeoutLossSeat(clock: DecisionClockState, now: number): SeatIndex | null {
  if (!isClockDue(clock, now) || clock.activeSeat === null) return null;
  return clock.activeSeat;
}

export function withServerNow(clock: DecisionClockState | null, now: number): PublicDecisionClock | null {
  if (!clock) return null;
  return {
    turn: clock.turn,
    remainingMs: [clock.remainingMs[0], clock.remainingMs[1]],
    activeSeat: clock.activeSeat,
    startedAt: clock.startedAt,
    serverNow: now,
  };
}

export function persistedClockState(
  clock: (DecisionClockState & { serverNow?: number }) | null | undefined,
): DecisionClockState | null {
  if (!clock) return null;
  return {
    turn: clock.turn,
    remainingMs: [clock.remainingMs[0], clock.remainingMs[1]],
    activeSeat: clock.activeSeat,
    startedAt: clock.startedAt,
  };
}
