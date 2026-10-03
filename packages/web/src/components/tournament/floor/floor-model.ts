import { isSeriesOpen, seriesScore } from "../duel-rules";
import { matchScore, tournamentRecord, winnerScore } from "../matches/match-model";
import { parseDbTime } from "../sheet-dates";
import { buildStandings } from "../standings/standings-model";
import type { Match, TournamentDetail, ViewerStakes } from "../types";

/*
 * Everything the live tournament page works out from one payload, with no React in it.
 * The page draws a "floor": a strip of every table in the round, the viewer's own field,
 * and a locator card (a zone) for each round a player has been through.
 */

export type TournamentEnding = "finished" | "ended-early" | "cancelled" | null;

/** Completed with matches still unplayed means the organizer ended it, or the deadline passed. */
export function tournamentEnding(tournament: Pick<TournamentDetail, "status" | "matches">): TournamentEnding {
  if (tournament.status === "cancelled") return "cancelled";
  if (tournament.status !== "completed") return null;
  return tournament.matches.some((match) => match.status !== "completed") ? "ended-early" : "finished";
}

export function isByeMatch(match: Match): boolean {
  return match.metadata?.bye === true || match.playerTwoId === null;
}

export function isDecided(match: Match): boolean {
  return match.status === "completed" && match.winnerId !== null && !isByeMatch(match);
}

export function isPendingReport(match: Match): boolean {
  return (match.status === "pending_approval" || match.status === "pending") && !isByeMatch(match);
}

export function playsIn(match: Match, playerId: number | null): boolean {
  return playerId !== null && (match.playerOneId === playerId || match.playerTwoId === playerId);
}

export function otherPlayer(match: Match, playerId: number): { id: number | null; name: string } {
  return match.playerOneId === playerId
    ? { id: match.playerTwoId, name: match.playerTwoName ?? "Opponent" }
    : { id: match.playerOneId, name: match.playerOneName };
}

export function playerName(tournament: Pick<TournamentDetail, "participants">, matches: Match[], playerId: number): string {
  const found = tournament.participants.find((p) => p.playerId === playerId);
  if (found) return found.displayName;
  for (const match of matches) {
    if (match.playerOneId === playerId) return match.playerOneName;
    if (match.playerTwoId === playerId && match.playerTwoName) return match.playerTwoName;
  }
  return "Player";
}

/** Two letters, first capitalised: "Marik_Mains" becomes "Ma". Same rule as the kit's Mono. */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}

/* ---------- rounds ---------- */

/** Round robin makes every round at the start; single elimination draws a round when the last one ends. */
export function totalRounds(tournament: Pick<TournamentDetail, "format" | "participants" | "matches">): number {
  const max = tournament.matches.reduce((top, match) => Math.max(top, match.roundNumber), 0);
  if (tournament.format === "single_elim") {
    let rounds = 0;
    for (let n = tournament.participants.length; n > 1; n = Math.ceil(n / 2)) rounds += 1;
    return Math.max(rounds, max);
  }
  return max;
}

/** The earliest round with a match still to finish, else the last round that exists. */
export function currentRound(tournament: Pick<TournamentDetail, "matches">): number {
  const open = tournament.matches.filter((match) => match.status !== "completed" && !isByeMatch(match));
  if (open.length > 0) return Math.min(...open.map((match) => match.roundNumber));
  return tournament.matches.reduce((top, match) => Math.max(top, match.roundNumber), 0);
}

/**
 * The one round the whole page is about, for the bar, the strip, the grid heading and the field caption.
 * A player with an open match: the round of the match on their field (the lowest of their own open rounds,
 * unless a reply they owe comes first). Anyone else: the lowest round with an open match, else the last round.
 * Rounds of a round robin are not gated, so open matches can sit in rounds 1, 4 and 5 at once.
 */
export function pageRound(tournament: TournamentDetail, viewerId: number | null): number {
  const mine = heroMatch(tournament, viewerId);
  return mine ? mine.roundNumber : currentRound(tournament);
}

export function roundName(tournament: Pick<TournamentDetail, "format" | "participants" | "matches">, round: number): string {
  if (tournament.format === "single_elim" && round === totalRounds(tournament)) return "Final";
  return `Round ${round}`;
}

/** Real matches of a round in engine (id) order. Table numbers count from 1 in this order. */
export function tableMatches(tournament: Pick<TournamentDetail, "matches">, round: number): Match[] {
  return tournament.matches
    .filter((match) => match.roundNumber === round && !isByeMatch(match))
    .sort((a, b) => a.id - b.id);
}

export function tableNumber(tournament: Pick<TournamentDetail, "matches">, match: Match): number {
  return tableMatches(tournament, match.roundNumber).findIndex((m) => m.id === match.id) + 1;
}

/** Names of the players who sit out a round (a bye). */
export function byeNames(tournament: Pick<TournamentDetail, "matches">, round: number, exceptPlayerId: number | null = null): string[] {
  return tournament.matches
    .filter((match) => match.roundNumber === round && isByeMatch(match) && match.playerOneId !== exceptPlayerId)
    .sort((a, b) => a.id - b.id)
    .map((match) => match.playerOneName);
}

/** "Kes", "Kes and Dara", "Kes, Dara and Mo". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/* ---------- the viewer ---------- */

export type HeroCase =
  | { kind: "match"; match: Match }
  | { kind: "bye"; round: number; rivals: string[] }
  | { kind: "waitdraw"; last: Match; won: boolean; waiting: string[] }
  | { kind: "none" }
  | { kind: "spectator" };

function heroPriority(match: Match, playerId: number): number {
  if (isPendingReport(match) && match.reporterId !== null && match.reporterId !== playerId) return 0; // owes a reply
  if (isSeriesOpen(match.series)) return 1;
  if (match.status === "open") return 2;
  return 3; // reported by the viewer, waiting on the opponent
}

/** The one match the viewer's field is drawn for, or null when nothing of theirs is unfinished. */
export function heroMatch(tournament: TournamentDetail, playerId: number | null): Match | null {
  if (playerId === null || !tournament.isParticipant) return null;
  const candidates = tournament.matches.filter((match) => playsIn(match, playerId) && !isByeMatch(match) && match.status !== "completed");
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => heroPriority(a, playerId) - heroPriority(b, playerId) || a.roundNumber - b.roundNumber || a.id - b.id)[0];
}

/** The three viewer cases of the brief, with the idle reason for a player who has no match. */
export function heroCase(tournament: TournamentDetail, playerId: number | null): HeroCase {
  if (playerId === null || !tournament.isParticipant) return { kind: "spectator" };
  const match = heroMatch(tournament, playerId);
  if (match) return { kind: "match", match };
  const mine = tournament.matches.filter((m) => playsIn(m, playerId)).sort((a, b) => b.roundNumber - a.roundNumber || b.id - a.id);
  const last = mine[0];
  if (!last) return { kind: "none" };
  const undone = tournament.matches.filter((m) => !isByeMatch(m) && m.status !== "completed");
  const sameRound = undone.filter((m) => m.roundNumber === last.roundNumber);
  const waiting = sameRound.flatMap((m) => [m.playerOneName, m.playerTwoName ?? ""]).filter(Boolean);
  if (isByeMatch(last) && waiting.length > 0) return { kind: "bye", round: last.roundNumber, rivals: waiting };
  if (tournament.format === "single_elim" && waiting.length > 0 && !isByeMatch(last)) {
    return { kind: "waitdraw", last, won: last.winnerId === playerId, waiting };
  }
  return { kind: "none" };
}

/** Stakes belong to the match the server picked. Show them only when that is the match on the field. */
export function stakesFor(tournament: Pick<TournamentDetail, "stakes">, match: Match): ViewerStakes | null {
  const stakes = tournament.stakes ?? null;
  return stakes && stakes.tournamentMatchId === match.id ? stakes : null;
}

/** "+18" or "−14", using the real minus sign. */
export function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

/* ---------- zones: one locator card per round for one player ---------- */

export type ZoneKind = "win" | "loss" | "pwin" | "ploss" | "now" | "open" | "none" | "bye";

export interface ZoneInfo {
  round: number;
  kind: ZoneKind;
  match: Match | null;
  /** The player across the table. */
  opponentId: number | null;
  opponentName: string;
}

export function zoneFor(tournament: Pick<TournamentDetail, "matches">, playerId: number, round: number, heroId: number | null): ZoneInfo {
  const match = tournament.matches.find((m) => m.roundNumber === round && playsIn(m, playerId)) ?? null;
  if (!match) return { round, kind: "none", match: null, opponentId: null, opponentName: "" };
  if (isByeMatch(match)) return { round, kind: "bye", match, opponentId: null, opponentName: "" };
  const opp = otherPlayer(match, playerId);
  const base = { round, match, opponentId: opp.id, opponentName: opp.name };
  if (match.status === "completed") {
    if (match.winnerId === null) return { ...base, kind: "none" };
    return { ...base, kind: match.winnerId === playerId ? "win" : "loss" };
  }
  if (isPendingReport(match)) return { ...base, kind: match.winnerId === playerId ? "pwin" : "ploss" };
  if (isSeriesOpen(match.series)) return { ...base, kind: "now" };
  return { ...base, kind: match.id === heroId ? "now" : "open" };
}

/** Every round 1 to `total` for a player. */
export function zonesFor(tournament: Pick<TournamentDetail, "matches">, playerId: number, total: number, heroId: number | null): ZoneInfo[] {
  return Array.from({ length: total }, (_, index) => zoneFor(tournament, playerId, index + 1, heroId));
}

/**
 * A row of zones shows at most 5: the 2 rounds before the current one, the current round and the 2 after it,
 * with a small counter at each end for the rest. Null means "show them all".
 */
export function roundWindow(total: number, current: number): { lo: number; hi: number } | null {
  if (total <= 5) return null;
  let lo = Math.max(1, current - 2);
  let hi = Math.min(total, current + 2);
  if (hi - lo < 4) {
    if (lo === 1) hi = 5; else lo = total - 4;
  }
  return { lo, hi };
}

/** "Rounds 1 to 3: 2 wins", "Round 6: 1 to play". */
export function rangeText(zones: ZoneInfo[], from: number, to: number): { full: string; short: string } {
  let wins = 0;
  let played = 0;
  for (const zone of zones.filter((z) => z.round >= from && z.round <= to)) {
    if (zone.kind === "win") { wins += 1; played += 1; } else if (zone.kind === "loss") played += 1;
  }
  const count = to - from + 1;
  const head = count > 1 ? `Rounds ${from} to ${to}` : `Round ${from}`;
  const tail = played > 0 ? `${wins} ${wins === 1 ? "win" : "wins"}` : `${count} to play`;
  return { full: `${head}: ${tail}`, short: tail };
}

/** Plain words for a zone, used as its label and tooltip. */
export function zoneLabel(tournament: Pick<TournamentDetail, "format" | "participants" | "matches">, zone: ZoneInfo, viewerId: number | null): string {
  const round = roundName(tournament, zone.round);
  const opp = zone.opponentName;
  const score = zone.match ? matchScore(zone.match) : null;
  const withScore = score ? ` ${score}` : "";
  switch (zone.kind) {
    case "win": return `${round}, beat ${opp}${withScore}`;
    case "loss": return `${round}, lost to ${opp}${withScore}`;
    case "pwin":
    case "ploss": {
      const owes = zone.match && zone.match.reporterId !== null ? (zone.match.playerOneId === zone.match.reporterId ? zone.match.playerTwoId : zone.match.playerOneId) : null;
      const who = owes === viewerId ? "you" : owes === null ? "the other player" : playerName(tournament, zone.match ? [zone.match] : [], owes);
      return `${round}, waiting for ${who} to confirm`;
    }
    case "now": return zone.match && isSeriesOpen(zone.match.series) ? `${round}, playing ${opp} now` : `${round}, plays ${opp}`;
    case "open": return `${round}, plays ${opp}`;
    case "bye": return `${round}, bye`;
    default: return `${round}, not drawn`;
  }
}

/* ---------- table status ---------- */

export function bestOfFor(tournament: Pick<TournamentDetail, "bestOf">, match?: Match | null): number {
  return match?.series?.bestOf ?? tournament.bestOf ?? 3;
}

/** Game wins as [player one, player two], or null when no online series backs the match. */
export function gameWins(match: Match): [number, number] | null {
  if (!match.series) return null;
  if (!isSeriesOpen(match.series) && !(match.status === "completed" && match.series.status === "completed")) return null;
  return seriesScore(match.series, match);
}

export function tableStatus(tournament: Pick<TournamentDetail, "participants" | "matches">, match: Match, viewerId: number | null): string {
  if (isSeriesOpen(match.series)) {
    return match.series.status === "between_games"
      ? `Between games. Game ${match.series.gameNumber + 1} next.`
      : `Game ${match.series.gameNumber} in progress`;
  }
  if (isPendingReport(match) && match.reporterId !== null) {
    const reporter = playerName(tournament, [match], match.reporterId);
    const otherId = match.playerOneId === match.reporterId ? match.playerTwoId : match.playerOneId;
    const waiting = otherId === viewerId ? "you" : otherId === null ? "the other player" : playerName(tournament, [match], otherId);
    return `Reported by ${reporter}. Waiting for ${waiting}.`;
  }
  if (match.status === "completed") {
    if (match.winnerId === null) return "Final";
    const winner = match.winnerId === match.playerOneId ? match.playerOneName : match.playerTwoName ?? "Opponent";
    const score = winnerScore(match);
    return `${winner} won${score ? ` ${score}` : ""}.`;
  }
  return "Not started";
}

/** "2–0 so far": a player's decided matches in this tournament. */
export function recordLine(tournament: Pick<TournamentDetail, "matches">, playerId: number): string {
  const record = tournamentRecord(tournament.matches as Match[], playerId);
  return `${record.wins}–${record.losses} so far`;
}

/* ---------- confirm, waiting, feed ---------- */

export interface ConfirmLine {
  match: Match;
  reporterName: string;
  text: string;
}

/** The match where the viewer owes an answer to a hand report, if any. */
export function confirmLine(tournament: TournamentDetail, viewerId: number | null): ConfirmLine | null {
  if (viewerId === null) return null;
  const match = tournament.matches.find((m) => isPendingReport(m) && playsIn(m, viewerId) && m.reporterId !== null && m.reporterId !== viewerId);
  if (!match || match.reporterId === null) return null;
  const reporterName = playerName(tournament, [match], match.reporterId);
  const subject = match.winnerId === match.reporterId ? "they" : "you";
  return { match, reporterName, text: `${reporterName} reported by hand that ${subject} won.` };
}

export interface WaitingItem {
  matchId: number;
  text: string;
}

/** Reports waiting on a reply, as plain sentences for the rail. */
export function waitingList(tournament: TournamentDetail): WaitingItem[] {
  const hours = tournament.reportConfirmWindowHours ?? 24;
  return tournament.matches
    .filter((match) => isPendingReport(match) && match.reporterId !== null)
    .sort((a, b) => a.id - b.id)
    .map((match) => {
      const reporterId = match.reporterId!;
      const reporter = playerName(tournament, [match], reporterId);
      const otherId = match.playerOneId === reporterId ? match.playerTwoId : match.playerOneId;
      const other = otherId === null ? "The other player" : playerName(tournament, [match], otherId);
      const verb = match.winnerId === reporterId ? "beating" : "losing to";
      return { matchId: match.id, text: `${reporter} reported ${verb} ${other}. ${other} confirms within ${hours} hours, or it approves itself.` };
    });
}

export interface FeedItem {
  key: string;
  matchId: number | null;
  /** SQLite time of the result, when the payload has one. */
  at: string | null;
  text: string;
}

/** Decided matches, newest first, then the start of the tournament. */
export function resultsFeed(tournament: TournamentDetail): FeedItem[] {
  const decided = tournament.matches
    .filter(isDecided)
    .map((match) => {
      const winnerIsOne = match.winnerId === match.playerOneId;
      const winner = winnerIsOne ? match.playerOneName : match.playerTwoName ?? "Opponent";
      const loser = winnerIsOne ? match.playerTwoName ?? "Opponent" : match.playerOneName;
      const score = winnerScore(match);
      return { match, text: `${winner} beat ${loser}${score ? ` ${score}` : ""}` };
    })
    .sort((a, b) => {
      const ta = parseDbTime(a.match.resolvedAt)?.getTime() ?? null;
      const tb = parseDbTime(b.match.resolvedAt)?.getTime() ?? null;
      if (ta !== null && tb !== null && ta !== tb) return tb - ta;
      if (ta !== null && tb === null) return -1;
      if (ta === null && tb !== null) return 1;
      return b.match.id - a.match.id;
    })
    .map(({ match, text }): FeedItem => ({ key: `m${match.id}`, matchId: match.id, at: match.resolvedAt, text }));
  if (tournament.startedAt) decided.push({ key: "start", matchId: null, at: tournament.startedAt, text: "The tournament started." });
  return decided;
}

/* ---------- champion ---------- */

export interface Champion {
  playerId: number;
  name: string;
  wins: number;
  losses: number;
}

/** First place only, and only for a tournament that played out. Single elimination: the final's winner. */
export function champion(tournament: TournamentDetail): Champion | null {
  if (tournamentEnding(tournament) !== "finished") return null;
  const standings = buildStandings(tournament);
  let id: number | null = null;
  if (tournament.format === "single_elim") {
    const decided = tournament.matches.filter(isDecided).sort((a, b) => b.roundNumber - a.roundNumber || b.id - a.id);
    id = decided[0]?.winnerId ?? null;
  } else {
    id = standings[0]?.playerId ?? null;
  }
  if (id === null) return null;
  const row = standings.find((r) => r.playerId === id);
  return { playerId: id, name: row?.displayName ?? playerName(tournament, tournament.matches, id), wins: row?.wins ?? 0, losses: row?.losses ?? 0 };
}

/** "You finished 2nd with 3–1." or the single elimination equivalent. */
export function finishLine(tournament: TournamentDetail, playerId: number | null): string | null {
  if (playerId === null || !tournament.isParticipant) return null;
  if (tournament.format === "single_elim") {
    const mine = tournament.matches.filter((m) => playsIn(m, playerId)).sort((a, b) => b.roundNumber - a.roundNumber)[0];
    if (mine && mine.roundNumber === totalRounds(tournament) && !isByeMatch(mine) && mine.winnerId !== playerId) return "You were the runner-up.";
    return "Your tournament is over.";
  }
  const row = buildStandings(tournament).find((r) => r.playerId === playerId);
  if (!row) return null;
  return `You finished ${ordinal(row.place)} with ${row.wins}–${row.losses}.`;
}

export function ordinal(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/* ---------- the moment ---------- */

export interface FinishedSeries {
  matchId: number;
  winnerId: number;
  loserId: number;
  roundNumber: number;
}

/** Matches that were not decided in `prev` and are decided in `next`. Byes never count. */
export function finishedSeries(prev: TournamentDetail, next: TournamentDetail): FinishedSeries[] {
  const before = new Map(prev.matches.map((match) => [match.id, match]));
  const out: FinishedSeries[] = [];
  for (const match of next.matches) {
    if (!isDecided(match)) continue;
    const old = before.get(match.id);
    if (old && isDecided(old)) continue;
    const loserId = match.winnerId === match.playerOneId ? match.playerTwoId! : match.playerOneId;
    out.push({ matchId: match.id, winnerId: match.winnerId!, loserId, roundNumber: match.roundNumber });
  }
  return out;
}

/**
 * One moment at most. The viewer's own finished match first; a spectator gets the first table of
 * the round; a player whose own match did not finish sees nothing fly (the zones just settle).
 */
export function pickMoment(finished: FinishedSeries[], viewerId: number | null, isParticipant: boolean): FinishedSeries | null {
  if (finished.length === 0) return null;
  if (viewerId !== null && isParticipant) {
    return finished.find((f) => f.winnerId === viewerId || f.loserId === viewerId) ?? null;
  }
  return [...finished].sort((a, b) => a.roundNumber - b.roundNumber || a.matchId - b.matchId)[0];
}
