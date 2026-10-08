import { diceOpeningView, type DuelDiceOpeningState, type DuelDiceOpeningView } from "./dice-opening.js";

/**
 * FFA games roll dice before each game; 1v1 game 1 uses rock-paper-scissors and the winner
 * chooses to go first or second. The engine always gives seat 0 the first turn, so the result only
 * decides the seat order. All rules live here as pure functions; the duel service stores the state
 * and the host drives the timers.
 */

export type DuelRpsMove = "rock" | "paper" | "scissors";
export type DuelFirstChoice = "first" | "second";

export const DUEL_RPS_MOVES: readonly DuelRpsMove[] = ["rock", "paper", "scissors"];

/** Time a player has to pick a move, or (for the winner) to choose first or second. */
export const DUEL_OPENING_PICK_MS = 30_000;
/** Extra time after a winning round, so the reveal can play without eating into the choice window. */
export const DUEL_OPENING_REVEAL_MS = 3_000;
/** A tied round shows briefly before players can throw again, with a full pick window afterward. */
export const DUEL_OPENING_TIE_REVEAL_MS = 2_000;

export function isRpsMove(value: unknown): value is DuelRpsMove {
  return value === "rock" || value === "paper" || value === "scissors";
}

export function isFirstChoice(value: unknown): value is DuelFirstChoice {
  return value === "first" || value === "second";
}

const BEATS: Record<DuelRpsMove, DuelRpsMove> = { rock: "scissors", paper: "rock", scissors: "paper" };

/** The seat that wins, or null for a tie. */
export function rpsWinner(picks: readonly [DuelRpsMove, DuelRpsMove]): 0 | 1 | null {
  if (picks[0] === picks[1]) return null;
  return BEATS[picks[0]] === picks[1] ? 0 : 1;
}

/** The last decided round. Public to both players once it is decided. */
export interface DuelOpeningReveal {
  round: number;
  /** By seat. */
  picks: [DuelRpsMove, DuelRpsMove];
  /** The winning seat, or null for a tie (the round is played again). */
  winnerSeat: 0 | 1 | null;
}

/**
 * The stored state. Every seat-indexed field follows the seats: when the opening ends and the
 * seats swap, `swapOpeningSeats` swaps these fields too.
 *
 * - `rps`: both players pick a move.
 * - `choose`: the winner chooses to go first or second.
 * - `start`: the order is settled and the seats are in their final order; the host starts the duel.
 */
export interface DuelRpsOpeningState {
  phase: "rps" | "choose" | "start";
  round: number;
  /** Epoch ms when the phase times out. */
  deadline: number;
  /** The player whose Start started the opening; the duel starts as this player. */
  startedBy: number;
  /** By seat. Hidden from everyone but the picker until both are in. */
  picks: [DuelRpsMove | null, DuelRpsMove | null];
  reveal: DuelOpeningReveal | null;
  winnerSeat: 0 | 1 | null;
  choice: DuelFirstChoice | null;
  /** True when the choice was made by the timeout, not by the winner. */
  choiceByTimeout: boolean;
}

/** What a client may see. Picks of the other seat stay hidden. */
export interface DuelRpsOpeningView {
  phase: "rps" | "choose" | "start";
  round: number;
  /** Server epoch ms when this view was built. */
  serverNow: number;
  /** ISO time the phase times out. */
  deadlineAt: string;
  /** By seat: the player has picked this round. */
  picked: [boolean, boolean];
  /** The viewer's own pick this round; null for a spectator or before a pick. */
  myPick: DuelRpsMove | null;
  reveal: DuelOpeningReveal | null;
  winnerSeat: 0 | 1 | null;
  choice: DuelFirstChoice | null;
  choiceByTimeout: boolean;
}

export type DuelOpeningState = DuelRpsOpeningState | DuelDiceOpeningState;
export type DuelOpeningView = DuelRpsOpeningView | DuelDiceOpeningView;

export function isDiceOpening(state: DuelOpeningState | DuelOpeningView): state is DuelDiceOpeningState | DuelDiceOpeningView {
  return "rounds" in state;
}

export class DuelOpeningError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "DuelOpeningError";
  }
}

export function newOpening(startedBy: number, at: number): DuelRpsOpeningState {
  return {
    phase: "rps",
    round: 1,
    deadline: at + DUEL_OPENING_PICK_MS,
    startedBy,
    picks: [null, null],
    reveal: null,
    winnerSeat: null,
    choice: null,
    choiceByTimeout: false,
  };
}

function seatOf(value: number): 0 | 1 {
  if (value !== 0 && value !== 1) throw new DuelOpeningError("Seat is not part of the opening", 400);
  return value;
}

/** Both picks are in: decide the round. A tie opens the next round, a win opens the choice. */
function decideRound(state: DuelRpsOpeningState, at: number): DuelRpsOpeningState {
  const [a, b] = state.picks;
  if (!a || !b) return state;
  const winnerSeat = rpsWinner([a, b]);
  const reveal: DuelOpeningReveal = { round: state.round, picks: [a, b], winnerSeat };
  if (winnerSeat === null) {
    return {
      ...state,
      round: state.round + 1,
      deadline: at + DUEL_OPENING_TIE_REVEAL_MS + DUEL_OPENING_PICK_MS,
      picks: [null, null],
      reveal,
    };
  }
  return {
    ...state,
    phase: "choose",
    deadline: at + DUEL_OPENING_REVEAL_MS + DUEL_OPENING_PICK_MS,
    picks: [a, b],
    reveal,
    winnerSeat,
  };
}

/** A pick is final. A second pick in the same round is refused. */
export function submitOpeningPick(state: DuelOpeningState, seatValue: number, move: DuelRpsMove, at: number): DuelRpsOpeningState {
  if (isDiceOpening(state)) throw new DuelOpeningError("Dice rolls are automatic", 409);
  const seat = seatOf(seatValue);
  if (state.phase !== "rps") throw new DuelOpeningError("The rock-paper-scissors game is over", 409);
  if (state.picks[seat] !== null) throw new DuelOpeningError("You already picked this round", 409);
  const picks: [DuelRpsMove | null, DuelRpsMove | null] = [state.picks[0], state.picks[1]];
  picks[seat] = move;
  return decideRound({ ...state, picks }, at);
}

/** Only the winner chooses. The seat order is settled by `finishOpening`. */
export function submitOpeningChoice(
  state: DuelOpeningState,
  seatValue: number,
  choice: DuelFirstChoice,
  at: number,
  byTimeout = false,
): DuelRpsOpeningState {
  if (isDiceOpening(state)) throw new DuelOpeningError("Dice rolls are automatic", 409);
  const seat = seatOf(seatValue);
  if (state.phase !== "choose") throw new DuelOpeningError("Nobody is choosing the turn order now", 409);
  if (state.winnerSeat !== seat) throw new DuelOpeningError("Only the winner chooses who goes first", 403);
  return { ...state, phase: "start", deadline: at, choice, choiceByTimeout: byTimeout };
}

/** True when the winner's choice needs the seats to swap (seat 0 goes first). */
export function openingNeedsSwap(state: DuelOpeningState): boolean {
  if (isDiceOpening(state)) return false;
  if (state.phase !== "start" || state.winnerSeat === null || state.choice === null) return false;
  return state.choice === "first" ? state.winnerSeat !== 0 : state.winnerSeat === 0;
}

/** Applies a seat swap to every seat-indexed field. */
export function swapOpeningSeats(state: DuelRpsOpeningState): DuelRpsOpeningState {
  const flip = (seat: 0 | 1 | null): 0 | 1 | null => (seat === null ? null : seat === 0 ? 1 : 0);
  return {
    ...state,
    picks: [state.picks[1], state.picks[0]],
    winnerSeat: flip(state.winnerSeat),
    reveal: state.reveal
      ? { ...state.reveal, picks: [state.reveal.picks[1], state.reveal.picks[0]], winnerSeat: flip(state.reveal.winnerSeat) }
      : null,
  };
}

/**
 * A timeout: a missing pick is made at random, a winner who does not choose goes first.
 * Returns the same state when nothing is due.
 */
export function settleOpening(state: DuelRpsOpeningState, at: number, random?: () => number): DuelRpsOpeningState;
export function settleOpening(state: DuelOpeningState, at: number, random?: () => number): DuelOpeningState;
export function settleOpening(state: DuelOpeningState, at: number, random: () => number = Math.random): DuelOpeningState {
  if (isDiceOpening(state)) throw new DuelOpeningError("Use settleDiceOpening with a server die source for dice openings", 409);
  if (state.phase === "start" || at < state.deadline) return state;
  if (state.phase === "choose") {
    return submitOpeningChoice(state, state.winnerSeat as number, "first", at, true);
  }
  const pickRandom = (): DuelRpsMove => DUEL_RPS_MOVES[Math.min(2, Math.floor(random() * 3))]!;
  const picks: [DuelRpsMove | null, DuelRpsMove | null] = [state.picks[0] ?? pickRandom(), state.picks[1] ?? pickRandom()];
  return decideRound({ ...state, picks }, at);
}

export function openingView(state: DuelRpsOpeningState, mySeat: number | null, serverNow?: number): DuelRpsOpeningView;
export function openingView(state: DuelOpeningState, mySeat: number | null, serverNow?: number): DuelOpeningView;
export function openingView(state: DuelOpeningState, mySeat: number | null, serverNow = Date.now()): DuelOpeningView {
  if (isDiceOpening(state)) return diceOpeningView(state, serverNow);
  // Once the round is decided both picks are public through `reveal`; the live picks stay hidden.
  const live = state.phase === "rps";
  return {
    phase: state.phase,
    round: state.round,
    serverNow,
    deadlineAt: new Date(state.deadline).toISOString(),
    picked: [state.picks[0] !== null, state.picks[1] !== null],
    myPick: live && (mySeat === 0 || mySeat === 1) ? state.picks[mySeat] : null,
    reveal: state.reveal,
    winnerSeat: state.winnerSeat,
    choice: state.choice,
    choiceByTimeout: state.choiceByTimeout,
  };
}

export function parseOpening(raw: string | null): DuelOpeningState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DuelOpeningState;
    if (parsed && isDiceOpening(parsed) && (parsed.phase === "dice" || parsed.phase === "start")
      && Number.isFinite(parsed.deadline) && Array.isArray(parsed.rounds) && Array.isArray(parsed.groups)) return parsed;
    if (parsed && !isDiceOpening(parsed) && (parsed.phase === "rps" || parsed.phase === "choose" || parsed.phase === "start")
      && Number.isFinite(parsed.deadline) && Array.isArray(parsed.picks)) return parsed;
  } catch {
    // A corrupt opening is treated as no opening: the duel can start normally.
  }
  return null;
}
