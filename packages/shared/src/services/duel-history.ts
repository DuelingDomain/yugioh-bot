import type Database from "better-sqlite3";
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
type HistoryCursor = { v: 1; time: number | null; id: number };

const registeredDatabases = new WeakSet<Database.Database>();
export function registerDuelHistoryFunctions(db: Database.Database): void {
  if (registeredDatabases.has(db)) return;
  // Read only a bounded prefix until the independent backfill reaches the row.
  // Scan top-level scalar metadata (including format) without parsing a large board.
  db.function("duel_history_turn", { deterministic: true }, (raw: string | null) => {
    if (typeof raw !== "string") return null;
    let text = raw.trimStart();
    if (text.startsWith("[")) text = text.slice(1).trimStart();
    if (!text.startsWith("{")) return null;
    text = text.slice(1);
    const scalar = /^\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\s*([,}])/;
    for (let token; (token = scalar.exec(text)); text = text.slice(token[0].length)) {
      if (token[1] === '"turn"') {
        const turn = Number(token[2]);
        return Number.isSafeInteger(turn) && turn >= 0 ? turn : null;
      }
      if (token[3] === "}") break;
    }
    return null;
  });
  let lastQuery: string | undefined;
  let pattern: RegExp;
  // SQLite lower() folds only ASCII. Cache the escaped Unicode pattern for a scan.
  db.function("duel_history_contains", { deterministic: true }, (value: string | null, query: string) => {
    if (query !== lastQuery) {
      pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
      lastQuery = query;
    }
    return value !== null && pattern.test(value) ? 1 : 0;
  });
  let lastPasscodes: string | undefined;
  let passcodes: Set<number>;
  // The uncorrelated SQL subquery supplies one catalog/artwork passcode set.
  // Parsing these small decks avoids expanding every card into a SQLite row.
  db.function("duel_history_deck_contains", { deterministic: true }, (raw: string | null, matching: string) => {
    if (matching !== lastPasscodes) {
      passcodes = new Set<number>(JSON.parse(matching));
      lastPasscodes = matching;
    }
    if (!raw || !passcodes.size) return 0;
    try {
      const deck = JSON.parse(raw);
      if (!deck || typeof deck !== "object") return 0;
      const hit = (code: unknown) => typeof code === "number" && Number.isInteger(code) && passcodes.has(code);
      return ["main", "extra", "side"].some(section => Array.isArray(deck[section]) && deck[section].some(hit))
        || hit(deck.deckMaster) ? 1 : 0;
    } catch { return 0; }
  });
  registeredDatabases.add(db);
}

/** List metadata only: saved boards, seeds and private engine state stay in SQLite. */
export const DUEL_LIST_COLUMNS = `duels.id, duels.kind, duels.guild_id, duels.web_slug, duels.name,
  duels.organizer_player_id, duels.mode, duels.master_rule, duels.status, duels.format, duels.setup_json,
  duels.settings_json, duels.created_at, duels.started_at, duels.ended_at, duels.archived_at,
  duels.last_activity_at, duels.winner_player_id, duels.winner_seat, duels.result_reason,
  duels.series_id, duels.game_number, duels.best_of, duels.ranked,
  (seed_json is not null and seed_json != '' and bundle_version is not null and bundle_version != '') as has_started,
  coalesce(duels.turn_count,
    duel_history_turn(substr(clock_json,1,256)),
    case when typeof(snapshot_public_json)='text' then duel_history_turn(substr(snapshot_public_json,1,256)) end,
    case when typeof(snapshot_seat0_json)='text' then duel_history_turn(substr(snapshot_seat0_json,1,256)) end,
    case when typeof(snapshot_seat1_json)='text' then duel_history_turn(substr(snapshot_seat1_json,1,256)) end,
    case when typeof(snapshot_seats_json)='text' then duel_history_turn(substr(snapshot_seats_json,1,256)) end) as turn_count`;

function readCursor(value: string): HistoryCursor {
  try {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error();
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error();
    const cursor = JSON.parse(decoded.toString("utf8")) as HistoryCursor;
    if (!cursor || cursor.v !== 1 || (cursor.time !== null && (!Number.isFinite(cursor.time) || cursor.time < 0 || cursor.time > 5373484.5))
      || !Number.isSafeInteger(cursor.id) || cursor.id <= 0 || Object.keys(cursor).length !== 3) throw new Error();
    return cursor;
  } catch { throw new DuelServiceError("Invalid history cursor", 400); }
}

export function historyCursor(row: { id: number; history_time: number | null }): string {
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

function historySearch(value: string | undefined, field: "q" | "card"): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 100) throw new DuelServiceError(`${field} must be text of at most 100 characters`, 400);
  return value.trim() || undefined;
}

/** Build only active predicates so SQLite can seek the guild/time index on later pages. */
export function duelHistoryQuery(guildId: string, playerId: number, canSeeAll: boolean, options: DuelHistoryOptions) {
  const scope = options.scope ?? "mine";
  if (scope !== "mine" && scope !== "all") throw new DuelServiceError("Scope must be mine or all", 400);
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new DuelServiceError("Limit must be a positive integer", 400);
  const pageLimit = Math.min(limit, 100);
  const q = historySearch(options.q, "q");
  const card = historySearch(options.card, "card");
  const params: Record<string, string | number> = { guild: guildId, viewer: playerId, limit: pageLimit + 1 };
  const adminAll = canSeeAll && scope === "all";
  const status = options.status ?? "any";
  if (!["any", "completed", "interrupted", "cancelled"].includes(status)) {
    throw new DuelServiceError("Status must be any, completed, interrupted, or cancelled", 400);
  }
  const where = ["guild_id = @guild", "kind = 'play'",
    adminAll ? "status in ('completed', 'interrupted', 'cancelled')" : "status in ('completed', 'interrupted')"];
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
  if (q) {
    params.q = q;
    where.push(`(duel_history_contains(name, @q) or exists (
      select 1 from duel_seats s left join players p on p.id = s.player_id
      where s.duel_id = duels.id and duel_history_contains(case when s.is_bot = 1 then 'Practice Bot' else p.display_name end, @q)
    ))`);
  }
  // Any-seat deck searches are diagnostic owner reads. Member filtering would
  // expose hidden opponent cards through whether a duel is included.
  let prefix = "";
  if (canSeeAll && card) {
    params.card = card;
    // Match names once, then resolve artwork passcodes before inspecting any decks.
    // An artwork's canonical name takes precedence over its own catalog entry.
    prefix = `with matching_cards(id) as materialized (
      select ygoprodeck_id from card_catalog where duel_history_contains(name, @card)
    ), matching_passcodes(id) as materialized (
      select c.id from matching_cards c where not exists (
        select 1 from card_artworks a where a.artwork_id = c.id and a.card_id != c.id
      )
      union select a.artwork_id from card_artworks a join matching_cards c on c.id = a.card_id
    )`;
    where.push(`exists (select 1 from matching_passcodes) and exists (
      select 1 from duel_seats s where s.duel_id = duels.id
        and duel_history_deck_contains(s.deck_json, (select json_group_array(id) from matching_passcodes))
    )`);
  }
  const select = (predicates: string[], nullTime = false) => `${prefix} select ${DUEL_LIST_COLUMNS}, ${HISTORY_TIME} as history_time,
    (select s.seat from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer) as my_seat
    from duels where ${predicates.join(" and ")}
    order by ${nullTime ? "" : `${HISTORY_TIME} desc, `}id desc limit @limit`;
  let nullTimeSql: string | undefined;
  let nullTime = false;
  if (options.cursor !== undefined && options.cursor !== null) {
    const cursor = readCursor(options.cursor);
    params.cursorId = cursor.id;
    if (cursor.time === null) {
      nullTime = true;
      where.push(`${HISTORY_TIME} is null`, "id < @cursorId");
    } else {
      // Fill the final dated page from the unreadable-time tail with a separate
      // indexed query. An OR here would prevent SQLite seeking the time index.
      if (options.from === undefined && options.to === undefined) nullTimeSql = select([...where, `${HISTORY_TIME} is null`], true);
      params.cursorTime = cursor.time;
      // The tuple alone orders correctly but SQLite does not seek expression
      // indexes for it. This redundant bound lets later pages seek by time.
      where.push(`${HISTORY_TIME} <= @cursorTime`);
      where.push(`(${HISTORY_TIME}, id) < (@cursorTime, @cursorId)`);
    }
  }
  return { limit: pageLimit, params, sql: select(where, nullTime), nullTimeSql };
}
