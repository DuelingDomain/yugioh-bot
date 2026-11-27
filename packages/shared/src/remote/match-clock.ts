import { REMOTE_EXTRA_TURNS, type RemoteMatch, type RemoteMatchClock, type RemoteMatchTimeResult, type RemoteTimeEvent } from "./match-contract.js";
import { cloneRemoteCurrent } from "./position.js";
import type { RemoteState } from "./types.js";

export function startRemoteMatchClock(match: RemoteMatch, at: number): void {
  if (match.clock?.minutes && match.clock.offAt === undefined) match.clock.startedAt ??= at;
}

export function remoteMatchDeadline(clock: RemoteMatchClock | undefined): number | undefined {
  if (!clock?.minutes || clock.startedAt === undefined || clock.offAt !== undefined) return undefined;
  return clock.startedAt + clock.minutes * 60_000;
}

export function remoteTimeTurn(state: Pick<RemoteState, "match" | "turn">): number | undefined {
  const clock = state.match.clock;
  if (clock?.offAt !== undefined || clock?.called?.turn == null) return undefined;
  return state.turn - clock.called.turn;
}

export function remoteTimeLpLeaders(state: RemoteState): number[] {
  const living = state.seats.filter(seat => !seat.eliminated);
  const highest = Math.max(...living.map(seat => seat.resources.lp));
  return living.filter(seat => seat.resources.lp === highest).map(seat => seat.seat);
}

export function remoteTimeResult(state: RemoteState, reason: RemoteMatchTimeResult): Extract<RemoteTimeEvent, { type: "time.result" }> {
  const contenders = state.seats.filter(seat => !seat.accountDeleted);
  const wins = contenders.map(seat => ({ seat: seat.seat, wins: state.match.games.filter(game => game.winnerSeat === seat.seat).length }));
  const highest = Math.max(...wins.map(player => player.wins));
  const leaders = wins.filter(player => player.wins === highest).map(player => player.seat);
  const lpLeaders = reason === "lp" ? remoteTimeLpLeaders(state) : [];
  const winners = reason === "lp" && state.seatCount > 2 ? lpLeaders : leaders;
  return { type: "time.result", reason, winnerSeat: winners.length === 1 ? winners[0] : null,
    ...(winners.length > 1 && state.seatCount > 2 ? { tiedSeats: winners } : {}) };
}

export function remoteTimeResultAfterGame(before: RemoteState, after: RemoteState): Extract<RemoteTimeEvent, { type: "time.result" }> | undefined {
  if (remoteTimeTurn(after) === undefined || after.match.games.length <= before.match.games.length) return undefined;
  return remoteTimeResult(after, after.match.games.at(-1)?.reason === "timeout" ? "lp" : "game-ended");
}

/** Time events are recorded by the service and applied the same way to live state and replay. */
export function applyRemoteTimeEvent(state: RemoteState, action: RemoteTimeEvent, at: number): RemoteState {
  if (action.type === "time.extraTurn" || !state.match.clock) return state;
  const next = cloneRemoteCurrent(state);
  const clock = next.match.clock!;
  next.updatedAt = Math.max(at, state.updatedAt);
  if (action.type === "time.called") {
    clock.called = { at, turn: action.turn, seat: action.seat };
  } else {
    clock.result = action.reason;
    if (action.tiedSeats) clock.tiedSeats = [...action.tiedSeats];
    next.match.phase = "done";
    next.match.winnerSeat = action.winnerSeat;
    delete next.match.siding;
    delete next.match.firstSeat;
    delete next.match.firstChooser;
    delete next.match.pendingResult;
    next.ended = true;
    // winnerSeat on the board is the last game's result. Match winner lives on match.winnerSeat.
    next.attack = null;
    next.undo = null;
    delete next.undoHistory;
  }
  return next;
}

export function remoteExtraTurnEvent(state: RemoteState): Extract<RemoteTimeEvent, { type: "time.extraTurn" }> | undefined {
  const extraTurn = remoteTimeTurn(state);
  if (extraTurn === undefined || extraTurn < 1 || extraTurn > REMOTE_EXTRA_TURNS) return undefined;
  return { type: "time.extraTurn", extraTurn, turn: state.turn, seat: state.turnSeat };
}
