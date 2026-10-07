import {
  DUEL_OPENING_PICK_MS,
  type DuelFirstChoice,
  type DuelOpeningView,
  type DuelRpsMove,
} from "@yugidraft/shared/duels";

/**
 * What the rock-paper-scissors opening shows, as plain data. The server decides everything; this
 * only turns the view and the clock into the screen to draw, so it can be tested without React.
 */

export const MOVE_LABEL: Record<DuelRpsMove, string> = { rock: "Rock", paper: "Paper", scissors: "Scissors" };

export type OpeningStage =
  /** A tied round is on screen before the next pick. */
  | "reveal"
  /** Both players pick a move. */
  | "pick"
  /** The viewer won and chooses first or second. */
  | "choose"
  /** The other player won and chooses. */
  | "wait-choose"
  /** The order is settled; the duel is about to start. */
  | "start";

/** Epoch ms when the tie reveal ends and the next pick starts. */
export function revealEndsAt(opening: DuelOpeningView): number {
  return Date.parse(opening.deadlineAt) - DUEL_OPENING_PICK_MS;
}

/** The tie reveal belongs to the round before this pick. */
function revealIsCurrent(opening: DuelOpeningView): boolean {
  if (!opening.reveal) return false;
  return opening.phase === "rps" && opening.reveal.round === opening.round - 1;
}

export function openingStage(opening: DuelOpeningView, mySeat: number | null, now: number): OpeningStage {
  if (opening.phase === "start") return "start";
  // The server already accepts the winner's choice. A browser clock must not hide it until the timeout.
  if (opening.phase === "choose") return mySeat != null && opening.winnerSeat === mySeat ? "choose" : "wait-choose";
  if (revealIsCurrent(opening) && now < revealEndsAt(opening)) return "reveal";
  return "pick";
}

export type RevealOutcome = "win" | "lose" | "tie" | "decided";

/** The reveal outcome for the viewer; spectators get "decided" for a winning round. */
export function revealOutcome(opening: DuelOpeningView, mySeat: number | null): RevealOutcome | null {
  const reveal = opening.reveal;
  if (!reveal) return null;
  if (reveal.winnerSeat === null) return "tie";
  if (mySeat !== 0 && mySeat !== 1) return "decided";
  return reveal.winnerSeat === mySeat ? "win" : "lose";
}

/** The viewer's own seat and the other seat; a spectator is shown seat 0 against seat 1. */
export function openingSeats(mySeat: number | null): { me: 0 | 1; them: 0 | 1 } {
  return mySeat === 1 ? { me: 1, them: 0 } : { me: 0, them: 1 };
}

/** The state of the other player's pick this round. */
export function opponentPickText(opening: DuelOpeningView, mySeat: number | null, name: string): { text: string; done: boolean } {
  const { them } = openingSeats(mySeat);
  const done = opening.picked[them];
  const who = mySeat == null ? name : "Opponent";
  return { text: done ? `${who} chose` : `${who} is choosing…`, done };
}

export function myPickText(opening: DuelOpeningView, mySeat: number | null): { text: string; done: boolean } | null {
  if (mySeat == null) return null;
  const done = opening.picked[mySeat === 1 ? 1 : 0];
  return { text: done ? "You chose" : "Choose your move", done };
}

export function waitChooseText(opening: DuelOpeningView, mySeat: number | null, names: [string, string]): string {
  if (mySeat == null) return `${opening.winnerSeat == null ? "The winner" : names[opening.winnerSeat]} is choosing to go first or second…`;
  return "Opponent is choosing to go first or second…";
}

/** After the choice: who goes first, and how it was decided. */
export function startText(opening: DuelOpeningView, mySeat: number | null, names: [string, string]): string {
  const choice: DuelFirstChoice | null = opening.choice;
  const winner = opening.winnerSeat;
  if (choice == null || winner == null) return "Starting the duel…";
  const mine = mySeat != null;
  const who = !mine ? names[winner] : winner === mySeat ? "You" : "Opponent";
  const verb = who === "You" ? "choose" : "chooses";
  const goes = choice === "first" ? "first" : "second";
  const base = who === "You" ? `You ${verb} to go ${goes}` : `${who} ${verb} to go ${goes}`;
  return opening.choiceByTimeout ? `${base} (time ran out)` : base;
}

/** True when a viewer who is not seated has nothing to play. */
export function isOpeningPlayer(mySeat: number | null): boolean {
  return mySeat === 0 || mySeat === 1;
}
