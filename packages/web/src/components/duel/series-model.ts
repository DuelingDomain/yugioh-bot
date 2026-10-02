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

/** The series index (0 or 1) of the seat on screen. The practice bot is index 1 and has no player id. */
export function seatSeriesIndex(series: Pick<DuelSeriesSummary, "playerIds">, seat: { playerId: number | null; isBot?: boolean } | undefined): 0 | 1 | null {
  if (!seat) return null;
  if (seat.isBot) return 1;
  const index = seat.playerId == null ? -1 : series.playerIds.indexOf(seat.playerId);
  return index === 0 ? 0 : index === 1 ? 1 : null;
}

/** Who won a finished series, as a series index; null for a draw or an open series. */
export function seriesWinnerIndex(series: Pick<DuelSeriesSummary, "winnerPlayerId" | "playerIds" | "status" | "vsBot" | "wins">): 0 | 1 | null {
  if (series.winnerPlayerId != null) {
    const index = series.playerIds.indexOf(series.winnerPlayerId);
    return index === 0 ? 0 : index === 1 ? 1 : null;
  }
  // The practice bot has no player id: it won when the series is over and its score leads.
  return series.vsBot && series.status === "completed" && series.wins[1] > series.wins[0] ? 1 : null;
}

/**
 * The note for a table that may play the practice bot, or null when nothing needs saying. A Best of 3
 * against the bot is a full match with side decking; it never counts, like every bot game.
 */
export function practiceBotNote(bestOf: 1 | 3): string {
  return bestOf === 3
    ? "Best of 3 works against the practice bot, with side decking between games. The match never counts."
    : "Games against the practice bot do not count. This table plays one game and records nothing.";
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
export function seriesKindLabel(series: Pick<DuelSeriesSummary, "tournamentId" | "ranked"> & { vsBot?: boolean }): string {
  return series.vsBot ? "Practice" : series.tournamentId != null ? "Tournament" : series.ranked ? "Ranked" : "Unranked";
}

/** What the finished series did with the result; null while it is still open or was cancelled. */
export function seriesRecordLabel(series: DuelSeriesSummary): string | null {
  if (series.status !== "completed") return null;
  if (series.vsBot) return "Practice match. No result recorded";
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
  const winnerIndex = seriesWinnerIndex(series);
  if (winnerIndex == null) return { headline: "Series drawn", detail: `Final score ${score}` };
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
 * first in it. After a decided game the loser chooses to go first or second (default first); after
 * a draw or an interrupted game the seats swap (the same rules as `createNextGame` in the shared
 * series service). Null unless the series waits between games on this duel.
 */
export function betweenGamesInfo(room: Pick<DuelRoom, "session" | "mySeat" | "series">, slug: string): BetweenGamesInfo | null {
  const series = room.series;
  if (!series || !isBetweenGames({ series }, slug)) return null;
  const index = seriesPlayerIndex(room, series);
  const played = room.session.gameNumber ?? series.gameNumber;
  const score = seriesCompactScore(series, index);
  const { session } = room;
  // The winner is the seat that won; the practice bot has no player id, so go through the seat.
  const winnerSeat = session.winnerSeat != null
    ? session.seats.find((seat) => seat.seat === session.winnerSeat)
    : session.winnerPlayerId != null ? session.seats.find((seat) => seat.playerId === session.winnerPlayerId) : undefined;
  const winnerIndex = seatSeriesIndex(series, winnerSeat);

  let result: string;
  let first: string;
  if (session.status === "completed" && winnerIndex != null) {
    const won = index == null ? series.displayNames[winnerIndex] : winnerIndex === index ? "you" : series.displayNames[winnerIndex];
    result = `Game ${played} won by ${won} · ${score}`;
    first = firstLine(series, index, played, winnerIndex === 0 ? 1 : 0);
  } else {
    result = session.status === "completed" ? `Game ${played} was a draw · ${score}` : `Game ${played} did not finish · ${score}`;
    const secondIndex = seatSeriesIndex(series, session.seats.find((seat) => seat.seat === 1));
    // The seats swap: the player in seat 1 now goes first.
    const firstIndex = secondIndex ?? 0;
    first = `${index != null && firstIndex === index ? "You go" : `${series.displayNames[firstIndex]} goes`} first (the seats swap)`;
  }
  return { result, next: `Game ${played + 1} of ${series.bestOf}`, first };
}

/** Who goes first after a decided game; `loserIndex` is the loser, who chooses. */
function firstLine(series: DuelSeriesSummary, index: 0 | 1 | null, played: number, loserIndex: 0 | 1): string {
  const chooser = series.firstChooser ?? loserIndex;
  if (series.firstChooser == null) {
    // A series saved before the choice existed: the loser goes first.
    const who = index != null && chooser === index ? "You go" : `${series.displayNames[chooser]} goes`;
    return `${who} first (the loser of game ${played} goes first)`;
  }
  const iChoose = index != null && chooser === index;
  if (series.firstChoice == null) {
    return iChoose ? "You choose to go first or second" : opponentChoosingText(series, index);
  }
  const firstIndex = series.firstChoice === "first" ? chooser : chooser === 0 ? 1 : 0;
  const who = index != null && firstIndex === index ? "You go" : `${series.displayNames[firstIndex]} goes`;
  const by = iChoose ? "you chose" : index == null ? `${series.displayNames[chooser]} chose` : "the opponent chose";
  return `${who} first (${by} to go ${series.firstChoice})`;
}

function opponentChoosingText(series: Pick<DuelSeriesSummary, "displayNames" | "firstChooser">, index: 0 | 1 | null): string {
  if (index == null && series.firstChooser != null) return `${series.displayNames[series.firstChooser]} is choosing to go first or second…`;
  return "Opponent is choosing to go first or second…";
}

/** True when the viewer lost the last game and chooses to go first or second now. */
export function viewerChoosesFirst(series: DuelSeriesSummary, index: 0 | 1 | null): boolean {
  return series.status === "between_games" && index != null && series.firstChooser === index;
}

export interface OpponentFirstStatus {
  text: string;
  /** The opponent has chosen. */
  done: boolean;
}

/** The other player's first or second choice: "Opponent is choosing to go first or second…" and then the result. */
export function opponentFirstStatus(series: DuelSeriesSummary, index: 0 | 1 | null): OpponentFirstStatus | null {
  if (series.status !== "between_games" || series.firstChooser == null) return null;
  if (index == null) {
    return series.firstChoice == null
      ? { text: opponentChoosingText(series, index), done: false }
      : { text: `${series.displayNames[series.firstChooser]} chose to go ${series.firstChoice}`, done: true };
  }
  if (series.firstChooser === index) return null;
  return series.firstChoice == null
    ? { text: opponentChoosingText(series, index), done: false }
    : { text: `Opponent chose to go ${series.firstChoice}`, done: true };
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
