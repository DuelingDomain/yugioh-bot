/**
 * Remote tournament results and evidence, as the organizer reads them.
 * `RemoteResult` follows docs/remote-duels/tournaments-api.md (planned B3 routes).
 * `RemoteEvidence` follows plan section 5.2 and the B4 storage columns. B4 has not published a read route yet, so the
 * path and field names below are the planned shape and must be checked against B4 before this ships.
 */
export type RemoteResultStatus = "playing" | "proposed" | "disputed" | "final" | "void";
export type RemoteReport = { playerId: number; choice: "confirm" | "dispute" | null; note: string | null; at: number | null };
export type RemoteResult = {
  tournamentMatchId: number; tableSlug: string; status: RemoteResultStatus;
  winnerPlayerId: number | null; score: { playerOne: number; playerTwo: number } | null;
  source: "concede" | "declared" | "lp" | null;
  proposedAt: number | null; confirmDeadlineAt: number | null;
  reports: RemoteReport[];
  finalizedAt: number | null; finalizationReason: "both_confirmed" | "timeout" | "organizer" | null;
  organizerDecision: { userId: number; winnerPlayerId: number | null; note: string | null; at: number } | null;
};

export type EvidenceGame = { number: number; winnerSeat: number | null; reason: string; endedAt: number | null };
export type EvidenceEvent = { seq: number; at: number; seat: number | null; userId: number | null; type: string; detail: string };
export type EvidenceBoard = { seat: number; monsters: string[]; spellTraps: string[]; graveyard: string[]; banished: string[] };
export type EvidenceDetection = { seat: number; autoSeconds: number; tapSeconds: number; cardsByClick: number; cardsTyped: number; manualFixes: number; unknownCards: number; noCamera?: boolean };
export type RemoteEvidence = {
  tableSlug: string; tableStartedAt: number | null; tableEndedAt: number | null; endReason: string | null;
  players: { seat: number; playerId: number; displayName: string }[];
  games: EvidenceGame[];
  finalLp: { game: number; lp: { seat: number; lp: number }[] }[];
  resultEvents: EvidenceEvent[];
  publicBoard: EvidenceBoard[] | null;
  detectionSummary: EvidenceDetection[];
  capturedAt: number; hardDeleteAt: number | null;
};

export const REMOTE_NOTE_MAX = 280;
export const SOURCE_TEXT: Record<NonNullable<RemoteResult["source"]>, string> = { concede: "a concede", declared: "a declared result", lp: "LP 0" };
export const END_TEXT: Record<string, string> = { won: "Match won", concede: "Concede", declared: "Declared and confirmed", lp: "LP 0", idle: "Table idle", left: "Creator left" };

/** A short date and time, in the viewer's locale. */
export const when = (at: number | null | undefined) => at ? new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export function choiceText(report: RemoteReport | undefined): string {
  if (!report || report.choice === null) return "No answer yet";
  return report.choice === "confirm" ? "Confirmed" : "Disputed";
}

/** One line per seat, in the words of plan section 6.3. It describes how complete the board record is. It does not decide the winner. */
export function detectionLine(item: EvidenceDetection, name: string): string {
  if (item.noCamera) return `${name}: no camera. Tap or manual play.`;
  const total = item.autoSeconds + item.tapSeconds;
  const mode = total === 0 ? "No mode time recorded" : item.tapSeconds === 0 ? "Auto the whole match" : item.autoSeconds === 0 ? "Tap the whole match" : `Auto ${minutes(item.autoSeconds)}, Tap ${minutes(item.tapSeconds)}`;
  const parts = [mode, `${item.manualFixes} manual ${item.manualFixes === 1 ? "fix" : "fixes"}`];
  if (item.cardsByClick) parts.push(`${item.cardsByClick} ${item.cardsByClick === 1 ? "card" : "cards"} by click`);
  if (item.cardsTyped) parts.push(`${item.cardsTyped} typed`);
  parts.push(`${item.unknownCards} unknown`);
  return `${name}: ${parts.join(", ")}.`;
}
const minutes = (seconds: number) => seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;

/** The planned evidence read. Not published by B4 yet. */
export const evidenceUrl = (tournamentSlug: string, tmId: number) => `/api/tournaments/${tournamentSlug}/matches/${tmId}/remote-evidence`;
export const resultUrl = (tournamentSlug: string, tmId: number) => `/api/tournaments/${tournamentSlug}/matches/${tmId}/remote-result`;
