/** The Remote result of one tournament match, as `GET .../remote-result` sends it (docs/remote-duels/tournaments-api.md). */

export type RemoteResultStatus = "playing" | "proposed" | "disputed" | "final" | "void";
export type RemoteResultSource = "concede" | "declared" | "lp";
export type RemoteReportChoice = "confirm" | "dispute";

export interface RemoteReport {
  playerId: number;
  choice: RemoteReportChoice | null;
  note: string | null;
  at: number | null;
}

export interface RemoteResult {
  tournamentMatchId: number;
  tableSlug: string | null;
  status: RemoteResultStatus;
  winnerPlayerId: number | null;
  score: { playerOne: number; playerTwo: number } | null;
  source: RemoteResultSource | null;
  proposedAt: number | null;
  confirmDeadlineAt: number | null;
  reports: RemoteReport[];
  finalizedAt: number | null;
  finalizationReason: "both_confirmed" | "timeout" | "organizer" | null;
  organizerDecision: { userId: number; winnerPlayerId: number | null; note: string | null; at: number } | null;
}

/** The two paired players of a slot, in the order the tournament holds them (player one first). */
export interface RemotePair {
  playerOneId: number;
  playerOneName: string;
  playerTwoId: number;
  playerTwoName: string;
}

export const DISPUTE_NOTE_MAX = 280;

/** A table or an answer is still open: the manual report is blocked and the slot waits on the Remote flow. */
export function remoteBlocksReport(result: RemoteResult | null): boolean {
  return result !== null && (result.status === "playing" || result.status === "proposed" || result.status === "disputed");
}

export function nameOf(pair: RemotePair, playerId: number | null): string {
  if (playerId === pair.playerOneId) return pair.playerOneName;
  if (playerId === pair.playerTwoId) return pair.playerTwoName;
  return "Someone";
}

/** The score with the winner first: "2–1". Null when the result has no score or winner yet. */
export function winnerScoreText(result: RemoteResult, pair: RemotePair): string | null {
  if (!result.score || result.winnerPlayerId === null) return null;
  const { playerOne, playerTwo } = result.score;
  return result.winnerPlayerId === pair.playerOneId ? `${playerOne}–${playerTwo}` : `${playerTwo}–${playerOne}`;
}

/** The headline: "Alice won 2–1". */
export function proposalLine(result: RemoteResult, pair: RemotePair): string {
  if (result.winnerPlayerId === null) return "No winner was recorded.";
  const score = winnerScoreText(result, pair);
  return `${nameOf(pair, result.winnerPlayerId)} won${score ? ` ${score}` : ""}.`;
}

export function reportOf(result: RemoteResult, playerId: number): RemoteReport | null {
  return result.reports.find((report) => report.playerId === playerId) ?? null;
}

/** "1 h 12 min", "35 min", "under 1 min". Null once the time is up. */
export function timeLeftText(deadlineAt: number, now: number): string | null {
  const ms = deadlineAt - now;
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return "under 1 min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** How the last game ended, in a few words. */
export function sourceText(source: RemoteResultSource | null): string | null {
  if (source === "concede") return "A player conceded.";
  if (source === "declared") return "Both players agreed on the winner at the table.";
  if (source === "lp") return "Life Points were entered by hand.";
  return null;
}

/** What the viewer's own answer means for the clock, as one plain line. */
export function clockNote(result: RemoteResult, viewerId: number, pair: RemotePair): string | null {
  if (result.status !== "proposed") return null;
  const mine = reportOf(result, viewerId);
  const otherId = viewerId === pair.playerOneId ? pair.playerTwoId : pair.playerOneId;
  const other = reportOf(result, otherId);
  const confirmed = (mine?.choice === "confirm" ? 1 : 0) + (other?.choice === "confirm" ? 1 : 0);
  if (confirmed === 2) return null;
  if (confirmed === 1 || result.source === "concede" || result.source === "declared") return "If nobody disputes, it becomes final when the time ends.";
  return "Without a confirm it does not finalize on its own. The organizer can decide.";
}
