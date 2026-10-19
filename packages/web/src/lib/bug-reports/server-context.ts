import type { DuelService } from "@yugidraft/shared/services";
import { isReplayFork } from "@yugidraft/shared/duels";
import { BUG_LOG_LINES, sanitizeLine, type BugFormat, type BugReportContext } from "../bug-report";
import { callDuelHost } from "../duel-host";

export interface ServerContextInput {
  guildId: string;
  playerId: number;
  duels: Pick<DuelService, "room">;
  duelSlug?: string;
  client: BugReportContext;
  now?: Date;
}

export interface ReportDiagnostics {
  board: Record<string, unknown> | null;
  /** Public log. The storage service keeps a bounded tail. */
  log: unknown[];
  attempts: number;
  source?: string;
  missingReason?: string;
}

export interface ServerReportContext {
  context: BugReportContext;
  duelVerified: boolean;
  replayFork?: true;
  diagnostics: ReportDiagnostics;
}

const intOrNull = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
// Only fixed messages may leave the server. Host error bodies can contain private data.
const HOST_REASONS = new Set([
  "the duel engine did not answer in time", "the duel engine view failed",
  "the duel has not started", "the duel has no saved board",
]);

/** Read trusted duel data, retry an incomplete capture once, and retain a safe reason on failure. */
export async function buildReportContext(input: ServerContextInput): Promise<ServerReportContext> {
  const { client } = input;
  const context: BugReportContext = { timestamp: (input.now ?? new Date()).toISOString() };
  const diagnostics: ReportDiagnostics = { board: null, log: [], attempts: 0 };
  const missing = (reason: string, verified: boolean): ServerReportContext => {
    diagnostics.missingReason = reason;
    context.logMissingReason = reason;
    context.boardMissingReason = reason;
    return { context, diagnostics, duelVerified: verified };
  };
  if (client.viewport) context.viewport = { width: client.viewport.width, height: client.viewport.height };
  if (client.animationSpeed !== undefined) context.animationSpeed = client.animationSpeed;
  if (client.userAgent) context.userAgent = client.userAgent.slice(0, 300);
  if (!input.duelSlug) return { context, diagnostics, duelVerified: false };

  let room: ReturnType<DuelService["room"]>;
  try {
    room = input.duels.room(input.duelSlug, input.guildId, input.playerId, { includeStoredBoard: false });
  } catch {
    return missing("no duel data was found", false);
  }
  if (isReplayFork(room.session)) return { context, diagnostics, duelVerified: false, replayFork: true };
  context.format = room.session.format as BugFormat;
  context.duelMode = room.session.mode;
  context.seat = room.mySeat;

  let reason = "the duel host did not return a board";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    diagnostics.attempts = attempt;
    try {
      const host = await callDuelHost({ op: "bug-context", slug: input.duelSlug, guildId: input.guildId, playerId: input.playerId });
      if (!host.ok) {
        reason = `the duel host returned HTTP ${host.response.status}`;
        if (host.retryable === false || host.response.status < 500 || host.response.status >= 600) break;
        continue;
      }
      if (!object(host.data)) {
        reason = "the duel host returned invalid data";
        continue;
      }
      const data = host.data;
      const turn = intOrNull(data.turn, 100000);
      if (turn !== null) context.turn = turn;
      if (typeof data.phase === "string" && data.phase) context.phase = sanitizeLine(data.phase, 60);
      const turnSeat = intOrNull(data.turnSeat, 7);
      if (turnSeat !== null) context.turnSeat = turnSeat;
      const living = intOrNull(data.livingPlayers, 8);
      if (living !== null) context.livingPlayers = living;
      if (Array.isArray(data.log)) {
        context.log = data.log.filter((line): line is string => typeof line === "string")
          .slice(-BUG_LOG_LINES).map((line) => sanitizeLine(line, 200));
        if (!diagnostics.board) diagnostics.log = data.log;
      }
      if (object(data.board) && Array.isArray(data.board.log)) {
        diagnostics.board = data.board;
        diagnostics.log = data.board.log;
        if (typeof data.source === "string" && ["live", "cached", "stored"].includes(data.source)) diagnostics.source = data.source;
        // A valid empty log is possible before the first game event.
        if (!context.log?.length) {
          context.log = data.board.log.filter((entry): entry is { text: string } => object(entry) && typeof entry.text === "string")
            .slice(-BUG_LOG_LINES).map(entry => sanitizeLine(entry.text, 200));
        }
        return { context, diagnostics, duelVerified: true };
      }
      reason = typeof data.missingReason === "string" && HOST_REASONS.has(data.missingReason)
        ? data.missingReason : "the duel host did not return a board";
    } catch (error) {
      const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      reason = timeout ? "the duel host request timed out" : "the duel host request failed";
      if (!timeout) break;
    }
  }
  diagnostics.missingReason = reason;
  context.boardMissingReason = reason;
  if (!context.log?.length) context.logMissingReason = reason;
  return { context, diagnostics, duelVerified: true };
}
