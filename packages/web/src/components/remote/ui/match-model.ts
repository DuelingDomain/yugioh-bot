import type { DuelDeck } from "@yugidraft/shared/duels";
import { REMOTE_EXTRA_TURNS, REMOTE_SIDE_DECK_MS, REMOTE_SIDE_MS, remoteMatchDeadline, remoteSideDeadline, remoteTimeTurn, type RemoteGameResult, type RemoteMatch, type RemoteRoom, type RemoteSiding } from "@yugidraft/shared/remote";

export type Match = RemoteMatch;
export type MatchGame = RemoteGameResult;
export type MatchSiding = RemoteSiding;
export const SIDE_MS = REMOTE_SIDE_MS;
export const SIDE_DECK_MS = REMOTE_SIDE_DECK_MS;

/** The match of a room. A room from before matches counts as one game in progress. */
export function matchOf(room: Pick<RemoteRoom, "state" | "bestOf">): Match {
  const match = room.state.match as Match | undefined;
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

/** The Konami end of a timed match, in one sentence (tooltip, timer menu, lobby hint). */
export const MATCH_TIME_RULE = `When time runs out, the turn in play is Turn 0. ${REMOTE_EXTRA_TURNS} extra turns follow, then the player with the most Life Points wins. Equal Life Points is a draw.`;

/**
 * Why the match ended on time. LP text only when Life Points decided it: "Time — Alice won on LP (8,000 vs 3,200)".
 * In a 1v1 an LP result is the last game's winner taking the match on games, so it reads "on games" when the games decided it.
 */
export function matchTimeReason(match: Match, name: (seat: number) => string, lp?: { of: (seat: number) => number; seats: number; out?: (seat: number) => boolean }): string | undefined {
  const clock = match.clock;
  if (!clock?.result) return undefined;
  const points = (value: number) => value.toLocaleString("en-US");
  const byLp = clock.result === "lp";
  if (clock.tiedSeats?.length || match.winnerSeat == null) {
    const tied = clock.tiedSeats ?? [];
    const who = tied.length && lp && tied.length < lp.seats ? ` between ${tied.map(name).join(", ")}` : "";
    const equal = lp && (tied.length ? true : lp.seats === 2 && lp.of(0) === lp.of(1));
    const each = byLp && lp && equal ? ` (${points(lp.of(tied.length ? tied[0] : 0))} each)` : "";
    return `Time — draw on ${byLp && (tied.length || equal) ? "LP" : "games"}${who}${each}`;
  }
  const winner = match.winnerSeat;
  const lastGame = match.games.at(-1);
  if (!byLp || !lp || (lp.seats <= 2 && lastGame?.winnerSeat !== winner)) return `Time — ${name(winner)} won on games`;
  const others = Array.from({ length: lp.seats }, (_, seat) => seat).filter(seat => seat !== winner && !lp.out?.(seat)).map(lp.of).sort((a, b) => b - a);
  return `Time — ${name(winner)} won on LP (${[lp.of(winner), ...others].map(points).join(" vs ")})`;
}

/** When a seat's siding clock ends (the server gives each seat its own cutoff). */
export function seatDeadline(siding: MatchSiding, seat: number): number {
  return remoteSideDeadline(siding, seat);
}

/** "3:00". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export type MatchClockDisplay = { text: string; label: string; tone?: "amber" | "red" | "muted"; rule?: string };

/** What the top-bar match clock shows at time `at` (server ms). Undefined when the match has no timer. */
export function matchClockDisplay(match: Match, turn: number, at: number): MatchClockDisplay | undefined {
  const timer = match.clock;
  if (!timer?.minutes) return undefined;
  if (timer.offAt !== undefined) return { text: "No timer", label: "Match timer is off", tone: "muted" };
  if (timer.result) return { text: "Time", label: "Match time is over", tone: "red", rule: MATCH_TIME_RULE };
  const extra = remoteTimeTurn({ match, turn });
  if (extra === 0) return { text: "Time · Turn 0", label: "Time. This is Turn 0", tone: "red", rule: MATCH_TIME_RULE };
  if (extra !== undefined) return { text: `Extra ${extra}/${REMOTE_EXTRA_TURNS}`, label: `Time. Extra turn ${extra} of ${REMOTE_EXTRA_TURNS}`, tone: "red", rule: MATCH_TIME_RULE };
  const deadline = remoteMatchDeadline(timer);
  const left = deadline === undefined ? timer.minutes * 60_000 : Math.max(0, deadline - at);
  const text = clock(left).padStart(5, "0");
  return { text, label: `Match time left ${text}`, tone: left < 60_000 ? "red" : left < 300_000 ? "amber" : undefined, rule: MATCH_TIME_RULE };
}

/** The deck of a seat, as the server holds it now (swaps included). Null: the seat plays with physical cards only. */
export function attachedDeck(room: Pick<RemoteRoom, "seats">, seat: number): DuelDeck | null {
  return room.seats.find(item => item.seat === seat)?.deck?.deck ?? null;
}
