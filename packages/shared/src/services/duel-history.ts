import type { DuelHistoryOptions } from "../duels/index.js";
import { isDuelFormat } from "../duels/settings.js";
import { DuelServiceError } from "./duels.js";
import { duelSeriesTournamentReadScope } from "./tournament-read-scope.js";

export const DUEL_LIST_ACCESS_SQL = `kind = 'play' and (
  organizer_player_id = @viewer
  or exists (select 1 from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer)
  or exists (select 1 from duel_invite_grants g where g.duel_id = duels.id and g.player_id = @viewer)
  or coalesce(json_extract(settings_json, '$.visibility'), 'public') != 'private'
)`;

const HISTORY_TIME = "julianday(coalesce(ended_at, created_at))";
type HistoryCursor = { v: 1; time: number; id: number };

function readCursor(value: string): HistoryCursor {
  try {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error();
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error();
    const cursor = JSON.parse(decoded.toString("utf8")) as HistoryCursor;
    if (!cursor || cursor.v !== 1 || !Number.isFinite(cursor.time) || cursor.time < 0 || cursor.time > 5373484.5
      || !Number.isSafeInteger(cursor.id) || cursor.id <= 0 || Object.keys(cursor).length !== 3) throw new Error();
    return cursor;
  } catch { throw new DuelServiceError("Invalid history cursor", 400); }
}

export function historyCursor(row: { id: number; history_time: number }): string {
  return Buffer.from(JSON.stringify({ v: 1, time: row.history_time, id: row.id })).toString("base64url");
}

/** SQLite's stored timestamps without offsets are UTC, never server-local time. */
export function historyTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(" ", "T");
  const time = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Require an explicit offset so local server time never changes the requested range. */
function historyDate(value: string, field: "from" | "to"): string {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match) throw new DuelServiceError(`${field} must be an ISO 8601 date-time with a timezone`, 400);
  const [, year, month, day, hour, minute, second, zone] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const time = Date.parse(value);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || (zone !== "Z" && zone !== "z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
    || !Number.isFinite(time)) throw new DuelServiceError(`Invalid ${field} date-time`, 400);
  return new Date(time).toISOString();
}

/** Build only active predicates so SQLite can seek the guild/time index on later pages. */
export function duelHistoryQuery(guildId: string, playerId: number, canSeeAll: boolean, options: DuelHistoryOptions) {
  const scope = options.scope ?? "mine";
  if (scope !== "mine" && scope !== "all") throw new DuelServiceError("Scope must be mine or all", 400);
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new DuelServiceError("Limit must be a positive integer", 400);
  const pageLimit = Math.min(limit, 100);
  const params: Record<string, string | number> = { guild: guildId, viewer: playerId, limit: pageLimit + 1 };
  const adminAll = canSeeAll && scope === "all";
  const status = options.status ?? "any";
  if (!["any", "completed", "interrupted", "cancelled"].includes(status)) {
    throw new DuelServiceError("Status must be any, completed, interrupted, or cancelled", 400);
  }
  const where = ["guild_id = @guild", "kind = 'play'",
    adminAll ? "status in ('completed', 'interrupted', 'cancelled')" : "status in ('completed', 'interrupted')",
    `${HISTORY_TIME} is not null`];
  if (adminAll && status !== "any") { params.status = status; where.push("status = @status"); }
  if (!adminAll) {
    where.push(DUEL_LIST_ACCESS_SQL, duelSeriesTournamentReadScope("duels.series_id"));
  }
  if (scope === "mine") where.push("exists (select 1 from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer)");
  if (options.from !== undefined) {
    params.from = historyDate(options.from, "from"); where.push(`${HISTORY_TIME} >= julianday(@from)`);
  }
  if (options.to !== undefined) {
    params.to = historyDate(options.to, "to"); where.push(`${HISTORY_TIME} <= julianday(@to)`);
  }
  if (params.from && params.to && params.from > params.to) throw new DuelServiceError("from must be before or equal to to", 400);
  if (options.format !== undefined) {
    if (!isDuelFormat(options.format)) throw new DuelServiceError("Duel format must be 1v1, tag, ffa3, or ffa4", 400);
    params.format = options.format; where.push("format = @format");
  }
  if (options.q) {
    params.q = options.q;
    where.push(`(duel_history_contains(name, @q) or exists (
      select 1 from duel_seats s left join players p on p.id = s.player_id
      where s.duel_id = duels.id and duel_history_contains(case when s.is_bot = 1 then 'Practice Bot' else p.display_name end, @q)
    ))`);
  }
  // Any-seat deck searches are diagnostic owner reads. Member filtering would
  // expose hidden opponent cards through whether a duel is included.
  if (canSeeAll && options.card) {
    params.card = options.card;
    // Walk only this duel's small saved seat decks, then use passcode primary-key lookups.
    // Artwork aliases resolve to their canonical card name. No engine or remote lookup.
    where.push(`exists (
      select 1 from duel_seats s, json_tree(case when json_valid(s.deck_json) then s.deck_json else '{}' end) code
      left join card_artworks a on a.artwork_id = code.atom
      join card_catalog c on c.ygoprodeck_id = coalesce(a.card_id, code.atom)
      where s.duel_id = duels.id and code.type = 'integer'
        and (code.path in ('$.main', '$.extra', '$.side') or code.fullkey = '$.deckMaster')
        and duel_history_contains(c.name, @card)
    )`);
  }
  if (options.cursor !== undefined && options.cursor !== null) {
    const cursor = readCursor(options.cursor);
    params.cursorTime = cursor.time; params.cursorId = cursor.id;
    // The tuple alone orders correctly but SQLite does not seek expression
    // indexes for it. This redundant bound lets later pages seek by time.
    where.push(`${HISTORY_TIME} <= @cursorTime`);
    where.push(`(${HISTORY_TIME}, id) < (@cursorTime, @cursorId)`);
  }
  return { limit: pageLimit, params, sql: `select duels.*, ${HISTORY_TIME} as history_time,
    (select s.seat from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer) as my_seat
    from duels where ${where.join(" and ")}
    order by ${HISTORY_TIME} desc, id desc limit @limit` };
}
