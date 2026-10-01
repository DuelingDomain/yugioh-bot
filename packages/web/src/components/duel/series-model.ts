import type { DuelRoom, DuelSeriesSummary } from "@yugidraft/shared/duels";

/** Pure helpers for the series (Best of 1 / Best of 3) parts of the duel screens. */

/** The viewer's player id in this game, or null for a spectator. */
export function myPlayerId(room: Pick<DuelRoom, "session" | "mySeat">): number | null {
  if (room.mySeat == null) return null;
  return room.session.seats.find((seat) => seat.seat === room.mySeat)?.playerId ?? null;
}

/** The viewer's position in `series.playerIds` (0 or 1), or null when the viewer is not a series player. */
export function seriesPlayerIndex(room: Pick<DuelRoom, "session" | "mySeat">, series: DuelSeriesSummary): 0 | 1 | null {
  const id = myPlayerId(room);
  if (id == null) return null;
  const index = series.playerIds.indexOf(id);
  return index === 0 ? 0 : index === 1 ? 1 : null;
}

export function isSeriesOpen(series: Pick<DuelSeriesSummary, "status">): boolean {
  return series.status === "active" || series.status === "between_games";
}

/** "1 – 0": player 0 first, in `playerIds` order. */
export function seriesScoreText(series: Pick<DuelSeriesSummary, "wins">): string {
  return `${series.wins[0]} – ${series.wins[1]}`;
}

/** The score from the viewer's side ("1 – 0" = viewer leads); a spectator sees `playerIds` order. */
export function seriesScoreForViewer(series: Pick<DuelSeriesSummary, "wins">, index: 0 | 1 | null): string {
  return index === 1 ? `${series.wins[1]} – ${series.wins[0]}` : seriesScoreText(series);
}

export function seriesLengthLabel(series: Pick<DuelSeriesSummary, "bestOf">): string {
  return `Best of ${series.bestOf}`;
}

/** Badge text for the kind of match: tournament, ranked or unranked. */
export function seriesKindLabel(series: Pick<DuelSeriesSummary, "tournamentId" | "ranked">): string {
  return series.tournamentId != null ? "Tournament" : series.ranked ? "Ranked" : "Unranked";
}

/** What the finished series did with the result; null while it is still open or was cancelled. */
export function seriesRecordLabel(series: DuelSeriesSummary): string | null {
  if (series.status !== "completed") return null;
  if (series.winnerPlayerId == null) return "Draw. No result recorded";
  if (series.tournamentId != null) return "Recorded to the bracket";
  return series.ranked ? "Ranked result recorded" : "Unranked";
}

export interface SeriesOutcome {
  headline: string;
  detail: string;
}

/** The end-of-series line: who won and the final score. Null while the series is open. */
export function seriesOutcome(series: DuelSeriesSummary, index: 0 | 1 | null): SeriesOutcome | null {
  if (series.status === "cancelled") return { headline: "Series cancelled", detail: "No result was recorded." };
  if (series.status !== "completed") return null;
  const score = seriesScoreForViewer(series, index);
  const winnerIndex = series.winnerPlayerId == null ? -1 : series.playerIds.indexOf(series.winnerPlayerId);
  if (winnerIndex < 0) return { headline: "Series drawn", detail: `Final score ${score}` };
  const name = series.displayNames[winnerIndex];
  const headline = index == null ? `${name} wins the series` : winnerIndex === index ? "You win the series" : `${name} wins the series`;
  return { headline, detail: `Final score ${score}` };
}

/** Whole seconds until `iso` (rounded up, never below 0); null when there is no deadline or it is not a date. */
export function secondsUntil(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/** 42 -> "0:42", 75 -> "1:15". */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The slug a seated series player should follow. Set when the series is still open and its latest
 * game is another duel than the one on screen. A finished series never moves anyone, so match
 * history can still open an old game.
 */
export function nextGameTarget(room: Pick<DuelRoom, "session" | "mySeat" | "series">, slug: string): string | null {
  const series = room.series;
  if (!series || !isSeriesOpen(series)) return null;
  if (!series.currentDuelSlug || series.currentDuelSlug === slug) return null;
  return seriesPlayerIndex(room, series) == null ? null : series.currentDuelSlug;
}

/** True when the side-deck window is open for this game: the series waits between games on this duel. */
export function isBetweenGames(room: Pick<DuelRoom, "series">, slug: string): boolean {
  const series = room.series;
  return series != null && series.status === "between_games" && (series.currentDuelSlug == null || series.currentDuelSlug === slug);
}

/** Casual interrupted series: there is no deadline, both players must click Ready, and either can cancel. */
export function canCancelInterrupted(series: DuelSeriesSummary): boolean {
  return series.status === "between_games" && series.nextGameAt == null && series.tournamentId == null;
}

/** "1–0" for the header: no spaces, the viewer's wins first (a spectator sees `playerIds` order). */
export function seriesCompactScore(series: Pick<DuelSeriesSummary, "wins">, index: 0 | 1 | null): string {
  return index === 1 ? `${series.wins[1]}–${series.wins[0]}` : `${series.wins[0]}–${series.wins[1]}`;
}

export interface SeriesGameLabel {
  /** "Game 2 of 3" */
  game: string;
  /** "1–0", the viewer's wins first */
  score: string;
  /** Tooltip with the names: "You 1 – 0 Imran". */
  title: string;
}

/**
 * The top-right label of the duel room for a game of a Best of 3. Null for a single game, a Best of 1
 * series and a cancelled series, so those rooms show nothing extra.
 */
export function seriesGameLabel(room: Pick<DuelRoom, "session" | "mySeat" | "series">): SeriesGameLabel | null {
  const series = room.series;
  if (!series || series.bestOf !== 3 || series.status === "cancelled") return null;
  const index = seriesPlayerIndex(room, series);
  const game = room.session.gameNumber ?? series.gameNumber;
  const score = seriesCompactScore(series, index);
  const title = index == null
    ? `${series.displayNames[0]} ${series.wins[0]} – ${series.wins[1]} ${series.displayNames[1]}`
    : `You ${series.wins[index]} – ${series.wins[index === 0 ? 1 : 0]} ${series.displayNames[index === 0 ? 1 : 0]}`;
  return { game: `Game ${game} of ${series.bestOf}`, score, title };
}

export interface BetweenGamesInfo {
  /** "Game 1 won by Sulman · 1–0" */
  result: string;
  /** "Game 2 of 3" */
  next: string;
  /** Who goes first in the next game, and why. */
  first: string;
}

/**
 * What the between-games screen says: how the last game ended, which game is next and who goes
 * first in it. The loser of the last game goes first; after a draw or an interrupted game the seats
 * swap (the same rule as `createNextGame` in the shared series service). Null unless the series
 * waits between games on this duel.
 */
export function betweenGamesInfo(room: Pick<DuelRoom, "session" | "mySeat" | "series">, slug: string): BetweenGamesInfo | null {
  const series = room.series;
  if (!series || !isBetweenGames({ series }, slug)) return null;
  const index = seriesPlayerIndex(room, series);
  const played = room.session.gameNumber ?? series.gameNumber;
  const score = seriesCompactScore(series, index);
  const { session } = room;
  const winnerId = session.winnerPlayerId
    ?? (session.winnerSeat == null ? null : session.seats.find((seat) => seat.seat === session.winnerSeat)?.playerId ?? null);
  const winnerIndex = winnerId == null ? -1 : series.playerIds.indexOf(winnerId);

  let result: string;
  let firstIndex: number;
  let why: string;
  if (session.status === "completed" && winnerIndex >= 0) {
    const won = index == null ? series.displayNames[winnerIndex] : winnerIndex === index ? "you" : series.displayNames[winnerIndex];
    result = `Game ${played} won by ${won} · ${score}`;
    firstIndex = winnerIndex === 0 ? 1 : 0;
    why = `the loser of game ${played} goes first`;
  } else {
    result = session.status === "completed" ? `Game ${played} was a draw · ${score}` : `Game ${played} did not finish · ${score}`;
    const second = session.seats.find((seat) => seat.seat === 1)?.playerId;
    firstIndex = second == null ? 0 : Math.max(0, series.playerIds.indexOf(second));
    why = "the seats swap";
  }
  const who = index != null && firstIndex === index ? "You go" : `${series.displayNames[firstIndex]} goes`;
  return { result, next: `Game ${played + 1} of ${series.bestOf}`, first: `${who} first (${why})` };
}

export interface OpponentSideStatus {
  text: string;
  ready: boolean;
}

/** The other player's state between games; null for a spectator. */
export function opponentSideStatus(series: DuelSeriesSummary, index: 0 | 1 | null): OpponentSideStatus | null {
  if (index == null) return null;
  if (series.sideReady[index === 0 ? 1 : 0]) return { text: "Opponent ready", ready: true };
  // No deadline: an interrupted game. Nobody is siding, the opponent has not clicked Ready.
  return { text: series.nextGameAt == null ? "Opponent is not ready" : "Opponent is siding…", ready: false };
}
