import type { DuelDeck } from "@yugidraft/shared/duels";
import type { RemoteActionProposal, RemoteRoom } from "@yugidraft/shared/remote";

/**
 * The match record, mirrored from docs/remote-duels/match-flow.md (feat/remote-match). One swap point: when the backend
 * is merged, import these types from `@yugidraft/shared/remote` and delete the copies here.
 */
export type MatchGame = { n: number; winnerSeat: number | null; reason: "lp" | "concede" | "declared" | "timeout"; endedAt: number };
export type MatchSiding = { deadline: number; ready: number[]; extendedFor: number[] };
export type Match = {
  bestOf: 1 | 3;
  games: MatchGame[];
  phase: "duel" | "result" | "siding" | "done";
  siding?: MatchSiding;
  winnerSeat?: number | null;
  pendingResult?: { id: string; winnerSeat: number | null; confirmed: number[] };
  firstChooser?: number | null;
  firstSeat?: number;
};

export const SIDE_MS = 180_000;
export const SIDE_DECK_MS = 300_000;

/** The match of a room. A room from before matches counts as one game in progress. */
export function matchOf(room: Pick<RemoteRoom, "state"> & { bestOf?: 1 | 3 }): Match {
  const match = (room.state as { match?: Match }).match;
  return match ?? { bestOf: room.bestOf ?? 1, games: [], phase: "duel" };
}

/** Wins per seat. A draw adds a game and no win. */
export function winsBySeat(match: Match, seatCount: number): number[] {
  const wins = Array.from({ length: seatCount }, () => 0);
  for (const game of match.games) if (game.winnerSeat !== null && wins[game.winnerSeat] !== undefined) wins[game.winnerSeat] += 1;
  return wins;
}

/** "1–0": my wins, then the best opponent's. Null on tables of 3 or more, which are won by elimination, and in BO1. */
export function matchScore(match: Match, seatCount: number, mySeat: number): string | null {
  if (match.bestOf < 3 || seatCount !== 2) return null;
  const wins = winsBySeat(match, seatCount);
  const me = mySeat >= 0 && mySeat < seatCount ? mySeat : 0;
  return `${wins[me]}–${wins[1 - me]}`;
}

export type GameOutcome = "win" | "lose" | "draw" | "spectator";

/** How a finished game reads for this viewer. A viewer without a seat, or a solo table, only watches. */
export function outcomeFor(winnerSeat: number | null, mySeat: number, solo: boolean): GameOutcome {
  if (winnerSeat === null) return "draw";
  if (solo || mySeat < 0) return "spectator";
  return winnerSeat === mySeat ? "win" : "lose";
}

export const HEADLINE: Record<GameOutcome, string> = { win: "Victory", lose: "Defeat", draw: "Draw", spectator: "Game over" };

/** One plain line on why the game ended. */
export function reasonLine(game: MatchGame | undefined, name: (seat: number) => string, mySeat: number, winnerSeat: number | null): string {
  if (!game) return "";
  const who = (seat: number) => (seat === mySeat ? "You" : name(seat));
  if (game.reason === "concede") return winnerSeat === null ? "A player conceded." : winnerSeat === mySeat ? "Your opponent conceded." : `${name(winnerSeat)} won by concession.`;
  if (game.reason === "declared") return winnerSeat === null ? "All players confirmed a draw." : `All players confirmed that ${who(winnerSeat)} won.`;
  if (game.reason === "timeout") return "The game ended on time.";
  return winnerSeat === null ? "Both players ran out of Life Points." : `${who(winnerSeat)} reduced the last opponent to 0 Life Points.`;
}

/** When a seat's siding clock ends. A table with a mix of physical and deck seats gives the physical seats 2 minutes less. */
export function seatDeadline(siding: MatchSiding, seat: number): number {
  if (siding.extendedFor.length === 0 || siding.extendedFor.includes(seat)) return siding.deadline;
  return siding.deadline - (SIDE_DECK_MS - SIDE_MS);
}

/** "3:00". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** A match action. The backend adds these names to the action union; until it is merged they pass through one cast. */
export function matchAction(action: { type: string; actorSeat: number } & Record<string, unknown>): RemoteActionProposal {
  return action as unknown as RemoteActionProposal;
}

/** The deck of a seat, as the server holds it now (swaps included). Null: the seat plays with physical cards only. */
export function attachedDeck(room: Pick<RemoteRoom, "seats">, seat: number): DuelDeck | null {
  return room.seats.find(item => item.seat === seat)?.deck?.deck ?? null;
}
