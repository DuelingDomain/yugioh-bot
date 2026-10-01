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
