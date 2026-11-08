/**
 * Remote tournament results and evidence, as the organizer reads them.
 * `RemoteResult` follows docs/remote-duels/tournaments-api.md (B3 routes).
 * `RemoteEvidence` is the view model. The B4 route sends the stored row (`RemoteEvidenceRow`: snake_case columns,
 * `*_json` strings); `evidenceFromRow` turns it into this.
 */
import type { RemoteReport, RemoteResult } from "../remote-result";
export type { RemoteReport, RemoteResult, RemoteResultStatus } from "../remote-result";

export type EvidenceGame = { number: number; winnerSeat: number | null; reason: string; endedAt: number | null };
export type EvidenceEvent = { seq: number; at: number; seat: number | null; userId: number | null; type: string; detail: string };
export type EvidenceBoard = { seat: number; monsters: string[]; spellTraps: string[]; graveyard: string[]; banished: string[] };
export type EvidenceDetection = { seat: number; /** Time before the seat announced a mode. */ unknownSeconds: number; autoSeconds: number; tapSeconds: number; manualSeconds: number; cardsByClick: number; cardsTyped: number; manualFixes: number; unknownCards: number };
export type RemoteEvidence = {
  tableSlug: string; tableStartedAt: number | null; tableEndedAt: number | null; endReason: string | null;
  players: { seat: number; userId: number | null; displayName: string }[];
  games: EvidenceGame[];
  finalLp: { game: number; lp: { seat: number; lp: number }[] }[];
  resultEvents: EvidenceEvent[];
  publicBoard: EvidenceBoard[] | null;
  detectionSummary: EvidenceDetection[];
  capturedAt: number; hardDeleteAt: number | null;
};

/** The `evidence` row of `GET .../remote-evidence`, as stored (docs/remote-duels/tournaments-api.md). */
export type RemoteEvidenceRow = {
  table_slug: string; player_one_user_id: number | null; player_two_user_id: number | null;
  players_json: string; table_started_at: number | null; table_ended_at: number; end_reason: string;
  games_json: string; result_events_json: string; final_lp_json: string; public_board_json: string;
  detection_summary_json: string; captured_at: number; hard_delete_at: number;
};

type StoredAction =
  | { type: "lp.change"; seat: number; delta: number; reason?: string }
  | { type: "player.concede" }
  | { type: "match.declare"; winnerSeat: number | null }
  | { type: "match.confirm"; accept: boolean }
  | { type: "undo" }
  | { type: "detection.mode"; mode: string };

/** The stored row as the view model. `names` are the two paired players in tournament order. Null when a column is not valid JSON. */
export function evidenceFromRow(row: RemoteEvidenceRow, names: { playerOne: string; playerTwo: string }): RemoteEvidence | null {
  try {
    const nameOf = (userId: number | null) => (userId === null ? "Deleted player" : userId === row.player_one_user_id ? names.playerOne : userId === row.player_two_user_id ? names.playerTwo : `User ${userId}`);
    const players = (JSON.parse(row.players_json) as { userId: number | null; seat: number }[]).map(player => ({ seat: player.seat, userId: player.userId, displayName: nameOf(player.userId) }));
    const seatName = (seat: number | null) => (seat === null ? "No one" : players.find(player => player.seat === seat)?.displayName ?? `Seat ${seat + 1}`);
    const games = (JSON.parse(row.games_json) as { n: number; winnerSeat: number | null; reason: string; endedAt: number | null }[])
      .map(game => ({ number: game.n, winnerSeat: game.winnerSeat, reason: game.reason, endedAt: game.endedAt }));
    const finalLp = (JSON.parse(row.final_lp_json) as { n: number; seats: { seat: number; lp: number }[] }[]).map(item => ({ game: item.n, lp: item.seats }));
    const resultEvents = (JSON.parse(row.result_events_json) as { seq: number; at: number; userId: number | null; seat: number | null; action: StoredAction }[])
      .map(event => ({ seq: event.seq, at: event.at, seat: event.seat, userId: event.userId, type: event.action.type, detail: eventText(event.action, seatName) }));
    const board = (JSON.parse(row.public_board_json) as { seat: number; cards: StoredCard[] }[]).map(item => boardOf(item.seat, item.cards));
    const detectionSummary = (JSON.parse(row.detection_summary_json) as StoredDetection[]).map(item => ({
      seat: item.seat, unknownSeconds: item.unknownSeconds ?? 0, autoSeconds: item.autoSeconds, tapSeconds: item.tapSeconds, manualSeconds: item.manualSeconds,
      cardsByClick: item.identifiedByClick, cardsTyped: item.identifiedByTyped, manualFixes: item.manualCorrections,
      // Unknown cards count at the end of the last game, where the record matters most.
      unknownCards: item.unknownAtGameEnd.at(-1)?.count ?? 0,
    }));
    return {
      tableSlug: row.table_slug, tableStartedAt: row.table_started_at, tableEndedAt: row.table_ended_at, endReason: row.end_reason,
      players, games, finalLp, resultEvents, publicBoard: board.length ? board : null, detectionSummary,
      capturedAt: row.captured_at, hardDeleteAt: row.hard_delete_at,
    };
  } catch { return null; }
}

type StoredCard = { zone: string; cardId?: number; passcode?: number; name?: string; position: "attack" | "defense" };
type StoredDetection = { seat: number; /** Missing in a row saved before this field existed. */ unknownSeconds?: number; autoSeconds: number; tapSeconds: number; manualSeconds: number; identifiedByClick: number; identifiedByTyped: number; manualCorrections: number; unknownAtGameEnd: { n: number; count: number }[] };

function eventText(action: StoredAction, seatName: (seat: number | null) => string): string {
  switch (action.type) {
    case "lp.change": return `${seatName(action.seat)} LP ${action.delta > 0 ? "+" : ""}${action.delta}${action.reason ? ` (${action.reason})` : ""}`;
    case "player.concede": return "Conceded";
    case "match.declare": return action.winnerSeat === null ? "Declared that there is no winner" : `Declared ${seatName(action.winnerSeat)} the winner`;
    case "match.confirm": return action.accept ? "Accepted the declared result" : "Rejected the declared result";
    case "undo": return "Undid an earlier action";
    case "detection.mode": return `Card detection set to ${action.mode}`;
  }
}

function boardOf(seat: number, cards: StoredCard[]): EvidenceBoard {
  const label = (card: StoredCard) => `${card.name ?? (card.cardId !== undefined ? `Card ${card.cardId}` : card.passcode !== undefined ? `Card ${card.passcode}` : "Unknown card")}${card.position === "defense" && /monster/.test(card.zone) ? " (DEF)" : ""}`;
  const zone = (...zones: string[]) => cards.filter(card => zones.includes(card.zone)).map(label);
  return { seat, monsters: zone("monster", "extra-monster"), spellTraps: zone("spell-trap", "field", "pendulum"), graveyard: zone("graveyard"), banished: zone("banished") };
}

export const REMOTE_NOTE_MAX = 280;
export const SOURCE_TEXT: Record<NonNullable<RemoteResult["source"]>, string> = { concede: "a concede", declared: "a declared result", lp: "LP 0" };
export const END_TEXT: Record<string, string> = { game: "Match finished", concede: "Concede", declared: "Declared and confirmed", lp: "LP 0", timeout: "Time ran out", idle: "Table idle", "creator-left": "Creator left", "account-deleted": "Player account deleted" };

/** A short date and time, in the viewer's locale. */
export const when = (at: number | null | undefined) => at ? new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export function choiceText(report: RemoteReport | undefined): string {
  if (!report || report.choice === null) return "No answer yet";
  return report.choice === "confirm" ? "Confirmed" : "Disputed";
}

/** One line per seat, in the words of plan section 6.3. It describes how complete the board record is. It does not decide the winner. */
export function detectionLine(item: EvidenceDetection, name: string): string {
  const read = item.autoSeconds + item.tapSeconds;
  const total = read + item.manualSeconds + item.unknownSeconds;
  if (item.manualSeconds > 0 && read === 0 && item.unknownSeconds === 0) return `${name}: no camera. Tap or manual play.`;
  // Time before a mode was announced is shown as its own part. It is never counted as Auto-detect.
  const parts = [["Auto", item.autoSeconds], ["Tap", item.tapSeconds], ["Manual", item.manualSeconds], ["Mode not announced", item.unknownSeconds]] as const;
  const used = parts.filter(([, seconds]) => seconds > 0);
  const mode = total === 0 ? "No mode time recorded"
    : used.length === 1 && used[0][0] !== "Mode not announced" ? `${used[0][0]} the whole match`
    : used.map(([label, seconds]) => `${label} ${minutes(seconds)}`).join(", ");
  const rest = [`${item.manualFixes} manual ${item.manualFixes === 1 ? "fix" : "fixes"}`];
  if (item.cardsByClick) rest.push(`${item.cardsByClick} ${item.cardsByClick === 1 ? "card" : "cards"} by click`);
  if (item.cardsTyped) rest.push(`${item.cardsTyped} typed`);
  rest.push(`${item.unknownCards} unknown`);
  return `${name}: ${[mode, ...rest].join(", ")}.`;
}
const minutes = (seconds: number) => seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;

/** Organizer evidence read (B4). */
export const evidenceUrl = (tournamentSlug: string, tmId: number) => `/api/tournaments/${tournamentSlug}/matches/${tmId}/remote-evidence`;
export const resultUrl = (tournamentSlug: string, tmId: number) => `/api/tournaments/${tournamentSlug}/matches/${tmId}/remote-result`;
