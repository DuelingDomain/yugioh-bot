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
}

export interface PublicDecisionClock extends DecisionClockState {
  serverNow: number;
}

export function isSeatIndex(value: number | null | undefined): value is SeatIndex {
  return value === 0 || value === 1;
}

export function clockBudgetMs(turnSeconds: number): number | null {
  if (!Number.isFinite(turnSeconds) || turnSeconds <= 0) return null;
  return turnSeconds * 1000;
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
    startedAt: activeSeat === null ? null : now,
  };
}

/**
 * After an accepted engine command. Freeze remaining at `decidedAt` (player commit)
 * and start the next prompt owner at `resumeAt` so engine processing is not charged.
 * Does not invent a clock when none was persisted. New duel turns refill both seats.
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
): DecisionClockState | null {
  if (clockBudgetMs(turnSeconds) === null) return null;
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
  if (previous.turn !== view.turn) return startDecisionClock(view, turnSeconds, resumeAt);
  const remaining = liveRemainingMs(previous, decidedAt);
  const nextSeat = isSeatIndex(view.promptSeat) ? view.promptSeat : null;
  return {
    turn: previous.turn,
    remainingMs: remaining,
    activeSeat: nextSeat,
    startedAt: nextSeat !== null && remaining[nextSeat] > 0 ? resumeAt : null,
  };
}

/** Continue timeout: remaining frozen at zero for the expired seat; not due again until the next turn. */
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
