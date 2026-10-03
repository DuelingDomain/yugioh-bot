import type { DuelService } from "@yugidraft/shared/services";
import { BUG_LOG_LINES, sanitizeLine, type BugFormat, type BugReportContext } from "../bug-report";
import { callDuelHost } from "../duel-host";

const LOG_LINE_MAX = 200;

export interface ServerContextInput {
  guildId: string;
  playerId: number;
  duels: Pick<DuelService, "room">;
  duelSlug?: string;
  /** The validated context the browser sent. Only its browser primitives are used. */
  client: BugReportContext;
  now?: Date;
}

const intOrNull = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : null;

/**
 * The context a report keeps. The duel facts and the log are read on the server: the format, rules and seat from the
 * database, the turn, phase, living players and the last log lines from the duel host's public (spectator) view, which
 * holds only lines every player sees. From the browser it takes only the viewport, animation speed and browser, which
 * are capped primitives. Whatever else the browser sent (format, turn, a log) is ignored. If the player may not see
 * the duel, or the host cannot answer, the report has no duel facts that need the host and no log.
 */
export async function buildReportContext(input: ServerContextInput): Promise<BugReportContext> {
  const { client } = input;
  const context: BugReportContext = { timestamp: (input.now ?? new Date()).toISOString() };
  if (client.viewport) context.viewport = { width: client.viewport.width, height: client.viewport.height };
  if (client.animationSpeed !== undefined) context.animationSpeed = client.animationSpeed;
  if (client.userAgent) context.userAgent = client.userAgent.slice(0, 300);
  if (!input.duelSlug) return context;

  let room: ReturnType<DuelService["room"]>;
  try {
    room = input.duels.room(input.duelSlug, input.guildId, input.playerId);
  } catch {
    return context;
  }
  context.format = room.session.format as BugFormat;
  context.duelMode = room.session.mode;
  context.seat = room.mySeat;

  const host = await callDuelHost({ op: "bug-context", slug: input.duelSlug, guildId: input.guildId, playerId: input.playerId });
  if (!host.ok) return context;
  const data = host.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return context;
  const turn = intOrNull(data.turn, 100000);
  if (turn !== null) context.turn = turn;
  if (typeof data.phase === "string" && data.phase) context.phase = sanitizeLine(data.phase, 60);
  const turnSeat = intOrNull(data.turnSeat, 7);
  if (turnSeat !== null) context.turnSeat = turnSeat;
  const living = intOrNull(data.livingPlayers, 8);
  if (living !== null) context.livingPlayers = living;
  if (Array.isArray(data.log)) {
    context.log = data.log
      .filter((line): line is string => typeof line === "string")
      .slice(-BUG_LOG_LINES)
      .map((line) => sanitizeLine(line, LOG_LINE_MAX));
  }
  return context;
}
