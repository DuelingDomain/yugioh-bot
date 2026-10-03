import { isSeriesOpen, seriesScore, seriesScoreLabel } from "../duel-rules";
import type { Match, StandingsRow, TournamentDetail } from "../types";

export interface Standing extends StandingsRow {
  place: number;
}

export interface StandingCell {
  result: "self" | "w" | "l" | "live" | "wait" | "you" | "open";
  text: string;
  label: string | null;
  accessibleName: string;
  matchId: number | null;
}

export interface CrosstableRow extends Standing {
  cells: StandingCell[];
}

function isBye(match: Match): boolean {
  return match.playerTwoId == null || match.metadata.bye === true;
}

/** The standings route counts confirmed results only; a bye has no played result. */
export function buildStandings(tournament: Pick<TournamentDetail, "participants" | "matches">): Standing[] {
  const rows = tournament.participants.map(({ playerId, displayName }) => ({
    playerId, displayName, wins: 0, losses: 0, place: 0,
  }));
  const byPlayer = new Map(rows.map((row) => [row.playerId, row]));
  for (const match of tournament.matches) {
    if (isBye(match) || match.status !== "completed") continue;
    if (match.winnerId !== match.playerOneId && match.winnerId !== match.playerTwoId) continue;
    const loserId = match.winnerId === match.playerOneId ? match.playerTwoId! : match.playerOneId;
    const winner = byPlayer.get(match.winnerId!);
    const loser = byPlayer.get(loserId);
    if (winner) winner.wins += 1;
    if (loser) loser.losses += 1;
  }
  // Stable sorting retains joined/participant order for otherwise equal records.
  rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    row.place = previous && previous.wins === row.wins && previous.losses === row.losses ? previous.place : index + 1;
  }
  return rows;
}

function pairKey(one: number, two: number): string {
  return one < two ? `${one}:${two}` : `${two}:${one}`;
}

function buildCell(row: Standing, opponent: Standing, match: Match | undefined, viewerId: number | null): StandingCell {
  const prefix = `${row.displayName} vs ${opponent.displayName}: `;
  if (row.playerId === opponent.playerId) {
    return { result: "self", text: "", label: null, accessibleName: `${prefix}same player`, matchId: null };
  }
  const matchId = match?.id ?? null;
  const won = match?.winnerId === row.playerId;
  // seriesScore first aligns the fixed series players with the tournament slot,
  // then the player-two row reverses it to its own point of view.
  const score = match?.series && seriesScoreLabel(match.series, match) ? seriesScore(match.series, match) : null;
  const rowScore = score && match ? (row.playerId === match.playerOneId ? score : [score[1], score[0]]) : null;
  const scoreText = rowScore ? `${rowScore[0]}–${rowScore[1]}` : null;

  if (match?.status === "completed" && match.winnerId != null) {
    const result = won ? "w" : "l";
    const label = won ? "won" : "lost";
    return { result, text: scoreText ?? (won ? "W" : "L"), label, matchId,
      accessibleName: `${prefix}${label}${scoreText ? `, ${scoreText}` : ""}` };
  }
  if (match && isSeriesOpen(match.series)) {
    // gameNumber is the latest game, including draws; wins alone cannot tell
    // which game comes next during side decking.
    const game = match.series.gameNumber + (match.series.status === "between_games" ? 1 : 0);
    const direction = rowScore![0] > rowScore![1] ? "leads" : rowScore![0] < rowScore![1] ? "trails" : "tied";
    return { result: "live", text: scoreText!, label: `game ${game}`, matchId,
      accessibleName: `${prefix}live, game ${game}, ${row.displayName} ${direction} ${scoreText}` };
  }
  if (match?.status === "pending_approval" || match?.status === "pending") {
    return { result: "wait", text: won ? "W" : "L", label: "reported", matchId,
      accessibleName: `${prefix}reported ${won ? "win" : "loss"}, awaiting confirmation` };
  }
  if (match?.status === "open" && row.playerId === viewerId) {
    return { result: "you", text: "Play", label: null, matchId,
      accessibleName: `${prefix}not started, play now` };
  }
  return { result: "open", text: "·", label: null, matchId, accessibleName: `${prefix}not started` };
}

/** Both axes use standings order, and every cell is from its row player's side. */
export function buildCrosstable(tournament: Pick<TournamentDetail, "participants" | "matches">, currentUserPlayerId: number | null): CrosstableRow[] {
  const standings = buildStandings(tournament);
  const pairs = new Map<string, Match>();
  for (const match of tournament.matches) {
    if (!isBye(match)) pairs.set(pairKey(match.playerOneId, match.playerTwoId!), match);
  }
  return standings.map((row) => ({ ...row, cells: standings.map((opponent) =>
    buildCell(row, opponent, pairs.get(pairKey(row.playerId, opponent.playerId)), currentUserPlayerId),
  ) }));
}

export interface PlayerFlags {
  /** A duel of theirs is being played now. */
  live: boolean;
  /** A reported result is waiting for this player to approve or deny it. */
  owesReply: boolean;
}

/** The phone standings list marks who is playing and who owes a reply. */
export function buildPlayerFlags(tournament: Pick<TournamentDetail, "participants" | "matches">): Map<number, PlayerFlags> {
  const flags = new Map<number, PlayerFlags>(tournament.participants.map((p) => [p.playerId, { live: false, owesReply: false }]));
  for (const match of tournament.matches) {
    if (isBye(match) || match.status === "completed") continue;
    const ids = [match.playerOneId, match.playerTwoId!];
    if (isSeriesOpen(match.series)) {
      for (const id of ids) { const f = flags.get(id); if (f) f.live = true; }
    } else if ((match.status === "pending_approval" || match.status === "pending") && match.reporterId != null) {
      const debtor = ids.find((id) => id !== match.reporterId);
      const f = debtor === undefined ? undefined : flags.get(debtor);
      if (f) f.owesReply = true;
    }
  }
  return flags;
}
