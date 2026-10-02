import { projectMatch } from "@yugidraft/shared/scoring";
import { isSeriesOpen, seriesScore } from "../duel-rules";
import { parseDbTime } from "../sheet-dates";
import { deriveMyMatches } from "../use-my-matches";
import { UNRATED_ELO, type PlayerRatings } from "../sheet-contracts";
import type { Match, TournamentDetail } from "../types";

export type ViewerState = "open" | "your-open" | "reporting" | "reported" | "confirm" | "pending" | "live" | "between-games" | "decided" | "bye" | "reopening";

export function isMatchPlayer(match: Match, playerId: number | null): boolean {
  return playerId !== null && (match.playerOneId === playerId || match.playerTwoId === playerId);
}

export function opponent(match: Match, playerId: number) {
  return match.playerOneId === playerId
    ? { id: match.playerTwoId, name: match.playerTwoName ?? "Opponent" }
    : { id: match.playerOneId, name: match.playerOneName };
}

export function matchView(match: Match, playerId: number | null, isHost: boolean, tournament: Pick<TournamentDetail, "status" | "format">, ui: { reporting?: boolean; reopening?: boolean } = {}) {
  const bye = match.metadata?.bye === true || match.playerTwoId === null;
  const player = isMatchPlayer(match, playerId);
  const seriesOpen = isSeriesOpen(match.series);
  const confirm = player && match.reporterId !== null && match.reporterId !== playerId;
  let state: ViewerState;
  if (bye) state = "bye";
  else if (match.status === "completed") state = ui.reopening ? "reopening" : "decided";
  else if (seriesOpen) state = match.series!.status === "between_games" ? "between-games" : "live";
  else if (match.status === "pending_approval") state = confirm ? "confirm" : player && match.reporterId === playerId ? "reported" : "pending";
  else state = ui.reporting && player ? "reporting" : player ? "your-open" : "open";
  const lamp = state === "live" || state === "between-games" ? "live"
    : ["your-open", "reporting", "confirm"].includes(state) ? "you"
    : ["reported", "pending"].includes(state) ? "wait"
    : ["decided", "bye", "reopening"].includes(state) ? "done" : "open";
  const hasPlayers = !bye;
  return {
    state, lamp, player, seriesOpen,
    // Reporting and confirmation remain available on retained terminal slots, as the APIs allow.
    canReport: hasPlayers && player && match.status === "open" && !seriesOpen,
    canStart: tournament.status === "active" && hasPlayers && match.status === "open" && !seriesOpen && (player || isHost),
    canConfirm: hasPlayers && match.status === "pending_approval" && confirm,
    canSetResult: tournament.status === "active" && isHost && hasPlayers && (match.status === "open" || match.status === "pending_approval"),
    canOpen: hasPlayers && match.status !== "completed" && seriesOpen && !!match.series?.currentDuelSlug,
    canReopen: isHost && hasPlayers && match.status === "completed" && tournament.format === "round_robin",
  };
}

export function reportNames(match: Match) {
  const reporter = match.reporterId === match.playerOneId ? match.playerOneName : match.playerTwoName ?? "Opponent";
  const other = match.reporterId === match.playerOneId ? match.playerTwoName ?? "Opponent" : match.playerOneName;
  return { reporter, other, won: match.reporterId === match.winnerId };
}

export function decidedPlayers(match: Match) {
  const oneWon = match.winnerId === match.playerOneId;
  return {
    winner: { id: oneWon ? match.playerOneId : match.playerTwoId!, name: oneWon ? match.playerOneName : match.playerTwoName! },
    loser: { id: oneWon ? match.playerTwoId! : match.playerOneId, name: oneWon ? match.playerTwoName! : match.playerOneName },
  };
}

export function matchScore(match: Match): string | null {
  if (!match.series || (!isSeriesOpen(match.series) && !(match.status === "completed" && match.series.status === "completed"))) return null;
  return seriesScore(match.series, match).join("–");
}

export function winnerScore(match: Match): string | null {
  const score = matchScore(match);
  if (!score || !match.series) return null;
  const [one, two] = seriesScore(match.series, match);
  return match.winnerId === match.playerOneId ? `${one}–${two}` : `${two}–${one}`;
}

export function firstGameWinner(match: Match): string | null {
  if (!match.series || match.series.gameNumber !== 2 || match.series.wins[0] + match.series.wins[1] !== 1) return null;
  const id = match.series.playerIds[match.series.wins[0] === 1 ? 0 : 1];
  return id === match.playerOneId ? match.playerOneName : match.playerTwoName;
}

export function matchProjection(match: Match, playerId: number, ratings: PlayerRatings) {
  const opp = opponent(match, playerId);
  return projectMatch({ myElo: ratings.get(playerId)?.rating ?? UNRATED_ELO, oppElo: opp.id === null ? UNRATED_ELO : ratings.get(opp.id)?.rating ?? UNRATED_ELO, seasonMultiplier: 1 });
}

export function tournamentRecord(matches: Match[], playerId: number) {
  const completed = matches.filter(m => m.status === "completed" && m.metadata?.bye !== true && m.playerTwoId !== null && m.winnerId !== null && isMatchPlayer(m, playerId));
  return { wins: completed.filter(m => m.winnerId === playerId).length, losses: completed.filter(m => m.winnerId !== playerId).length };
}

/** The match the Your match card shows. The queue leaves it out so it never appears twice. */
export function featuredMatch(tournament: TournamentDetail, playerId: number | null): Match | null {
  if (!tournament.isParticipant || playerId === null) return null;
  return deriveMyMatches({ ...tournament, currentUserPlayerId: playerId }).actionMatch;
}

export function groupMatches(matches: TournamentDetail["matches"], playerId: number | null) {
  const live: Match[] = [], pending: Match[] = [], open: Match[] = [], decided: Match[] = [], byes: Match[] = [];
  for (const match of matches) {
    if (match.metadata?.bye === true || match.playerTwoId === null) byes.push(match);
    else if (match.status === "completed") { if (match.winnerId !== null) decided.push(match); }
    else if (isSeriesOpen(match.series)) live.push(match);
    else if (match.status === "pending_approval") pending.push(match);
    else if (match.status === "open") open.push(match);
  }
  open.sort((a, b) => Number(isMatchPlayer(b, playerId)) - Number(isMatchPlayer(a, playerId)));
  decided.sort((a, b) => (parseDbTime(b.resolvedAt)?.getTime() ?? 0) - (parseDbTime(a.resolvedAt)?.getTime() ?? 0));
  return { live, pending, open, decided, byes };
}
