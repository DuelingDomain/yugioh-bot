import type Database from "better-sqlite3";
import { teamOfSeat } from "@yugidraft/shared/duels";
import { DUEL_LIVE_IDLE_AFTER_MS } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { FORMAT_LABEL, dbTimeMs, isFormat, safeInt, seatsOf } from "./live";
import { failed, notConfigured, ok, type SectionLoader } from "./section";
import { ADMIN_TIME_ZONE, easternDayStart } from "./time";
import type { LiveDuelFormat, SeatOutcome, TodayData, TodayDuel, TodayResult } from "./types";

/** Rows sent to the browser. `counts` still covers every duel of the day. */
export const TODAY_LIMIT = 200;
const DAY_MS = 24 * 60 * 60_000;

type TodayRow = {
  id: number; web_slug: string; name: string; status: string; format: string; ranked: number; genesys: number;
  started_at: string; ended_at: string | null; activity_at: string | null; winner_seat: number | null;
  turn_count: number | null; clock_turn: number | null; n_all: number; n_multi: number; n_ranked: number;
};

function resultOf(row: TodayRow, now: number): TodayResult {
  if (row.status === "completed") return row.winner_seat !== null ? "won" : "draw";
  if (row.status === "interrupted") return "interrupted";
  if (row.status === "cancelled") return "cancelled";
  // An open table past the idle cut-off is about to be closed by the duel host.
  return now - (dbTimeMs(row.activity_at) ?? 0) <= DUEL_LIVE_IDLE_AFTER_MS ? "live" : "idle";
}

/**
 * Every play duel of the guild that started today, newest first, with seats and the result per seat.
 * One read of duels: the range on duels_play_history_idx (guild_id, julianday(coalesce(ended_at, created_at))) starts one
 * day before midnight, so a duel opened late yesterday and started after midnight is still found; started_at then picks
 * today exactly. Window functions count the whole day before the row cap. Seats come in one more query for all rows.
 */
export function loadTodayDuels(db: Database.Database, guild: string, now: number): TodayData {
  const dayStart = easternDayStart(now);
  const rows = db.prepare(`
    select d.id, d.web_slug, d.name, d.status, d.format, d.ranked, d.started_at, d.ended_at, d.winner_seat, d.turn_count,
      coalesce(d.last_activity_at, d.started_at, d.created_at) as activity_at,
      case when json_valid(d.settings_json) then json_extract(d.settings_json, '$.genesys') is not null else 0 end as genesys,
      case when d.status = 'active' and json_valid(d.clock_json) then json_extract(d.clock_json, '$.turn') end as clock_turn,
      count(*) over () as n_all,
      sum(d.format in ('tag', 'ffa3', 'ffa4')) over () as n_multi,
      sum(d.ranked = 1) over () as n_ranked
    from duels d
    where d.guild_id = @guild and d.kind = 'play'
      and julianday(coalesce(d.ended_at, d.created_at)) >= julianday(@floor)
      and d.started_at is not null and julianday(d.started_at) >= julianday(@dayStart)
    order by julianday(d.started_at) desc, d.id desc
    limit @limit`).all({
    guild, floor: new Date(dayStart - DAY_MS).toISOString(), dayStart: new Date(dayStart).toISOString(), limit: TODAY_LIMIT,
  }) as TodayRow[];
  const first = rows[0];
  const counts = { all: first?.n_all ?? 0, oneVsOne: (first?.n_all ?? 0) - (first?.n_multi ?? 0), multi: first?.n_multi ?? 0, ranked: first?.n_ranked ?? 0 };
  const seats = seatsOf(db, rows.map((row) => row.id));

  const duels = rows.map((row): TodayDuel => {
    const format: LiveDuelFormat = isFormat(row.format) ? row.format : "1v1";
    const result = resultOf(row, now);
    const ended = result !== "live" && result !== "idle";
    // Seats come in seat order. In Tag the winner's partner wins too (teamOfSeat).
    const outcome = (seat: number): SeatOutcome => result === "draw" ? "draw"
      : result === "won" && row.winner_seat !== null ? (teamOfSeat(format, seat) === teamOfSeat(format, row.winner_seat) ? "won" : "lost")
      : null;
    const startedAt = dbTimeMs(row.started_at) ?? dayStart;
    return {
      slug: row.web_slug, name: row.name, format, formatLabel: FORMAT_LABEL[format], ranked: row.ranked === 1, genesys: row.genesys === 1,
      result, seats: (seats.get(row.id) ?? []).map((seat, i) => ({ ...seat, outcome: outcome(i) })),
      turns: ended ? safeInt(row.turn_count) : safeInt(row.clock_turn),
      startedAt, endedAt: ended ? dbTimeMs(row.ended_at) : null,
      href: ended ? `/duels/${row.web_slug}/replay` : `/admin/watch/duel/${row.web_slug}`,
    };
  });
  return { timezone: ADMIN_TIME_ZONE, dayStart, counts, duels, limit: TODAY_LIMIT };
}

/**
 * Duels that started today, where a day is Eastern time (America/New_York) from 00:00 ET. The server picks the day.
 * Old clients still send `?tz=` and `?start=` (the browser's offset and midnight); both are ignored.
 */
export const loadToday: SectionLoader<"today"> = async ({ now }) => {
  const guild = env.discordGuildId;
  if (!guild) return notConfigured("Set DISCORD_GUILD_ID to list the duels of today.", now);
  try {
    return ok(loadTodayDuels(getDb(), guild, now), now);
  } catch {
    return failed("The duels of today could not be read from the database.", now);
  }
};
