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
  /** The server clock in ms when the result was read. Optional: the countdown falls back to the browser clock. */
  now?: number;
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

/** The winner that counts: the organizer's ruling when there is one, else the proposed winner. */
export function effectiveWinnerId(result: RemoteResult): number | null {
  const decision = result.organizerDecision;
  return decision && decision.winnerPlayerId !== null ? decision.winnerPlayerId : result.winnerPlayerId;
}

/** The headline: "Alice won 2–1". The score shows only while it belongs to the winner that counts. */
export function proposalLine(result: RemoteResult, pair: RemotePair): string {
  const winnerId = effectiveWinnerId(result);
  if (winnerId === null) return "No winner was recorded.";
  const score = winnerId === result.winnerPlayerId ? winnerScoreText(result, pair) : null;
  return `${nameOf(pair, winnerId)} won${score ? ` ${score}` : ""}.`;
}

/** The organizer's ruling in one line, when it changed the proposed winner or has a note. Null otherwise. */
export function rulingText(result: RemoteResult, pair: RemotePair): string | null {
  const decision = result.organizerDecision;
  if (!decision) return null;
  const parts: string[] = [];
  if (decision.winnerPlayerId === null) parts.push("The organizer voided the result.");
  else if (decision.winnerPlayerId !== result.winnerPlayerId) parts.push(`The organizer ruled that ${nameOf(pair, decision.winnerPlayerId)} won (proposed: ${result.winnerPlayerId === null ? "no winner" : nameOf(pair, result.winnerPlayerId)}).`);
  else parts.push("The organizer confirmed the result.");
  if (decision.note) parts.push(`Note: ${decision.note}`);
  return parts.join(" ");
}

/** Why a final result is final, in a few words. */
export function finalReasonText(reason: RemoteResult["finalizationReason"]): string | null {
  if (reason === "both_confirmed") return "Both players confirmed.";
  if (reason === "timeout") return "Nobody disputed before the time ended.";
  if (reason === "organizer") return "The organizer decided it.";
  return null;
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

/** API rule: both confirms finalize now; one confirm, or a concede or declared admission, finalizes at the deadline; LP alone never does. */
export function finalizesAtDeadline(result: RemoteResult): boolean {
  const confirmed = result.reports.filter((report) => report.choice === "confirm").length;
  return confirmed >= 1 || result.source === "concede" || result.source === "declared";
}

/** What the answers so far mean for the clock, as one plain line. */
export function clockNote(result: RemoteResult): string | null {
  if (result.status !== "proposed") return null;
  if (result.reports.filter((report) => report.choice === "confirm").length >= 2) return null;
  return finalizesAtDeadline(result)
    ? "If nobody disputes, it becomes final when the time ends."
    : "Without a confirm it does not finalize on its own. The organizer can decide.";
}
