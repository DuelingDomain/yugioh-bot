import type Database from "better-sqlite3";
import { DUEL_LIVE_IDLE_REASON } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { addDays, resolveDuelRange } from "./duel-range";
import { adminGate, adminJson, failed, notConfigured, ok } from "./section";
import { easternDayKey, easternHour } from "./time";
import type { DuelEndingCounts, DuelPeriodStats, DuelRangeInfo, DuelStatsData } from "./types";

/*
 * Stats of the Duels view. Everything is counted in SQL on the SQLite file, for the range and the period of the same length
 * right before it, in one pass per table. Only the Eastern day and hour buckets are made in JS, because SQLite has no
 * daylight-saving time zone.
 *
 * A counted duel started inside the period (duels.started_at, or remote_tables.started_at); a table that closed in its lobby
 * never started and is not counted. Replay forks are never counted. Practice-bot duels (a bot seat) and test duels
 * (setup_json.testDuel) are counted apart always, and join the totals only when `includeBots` is on.
 *
 * Indexes: duels_play_history_idx (guild_id, julianday(coalesce(ended_at, created_at))) where kind = 'play' bounds the duel
 * read from one day before the earliest start (a table opened before midnight and started after it is still found); seats
 * come by the primary key (duel_id, seat); first-duel look-ups use duel_seats_player_idx. remote_tables, users, bug_reports,
 * join_request_notifications and duel_replay_verifications are small and narrow; no index is added for them.
 */

const DAY_MS = 24 * 60 * 60_000;

/** SQL for the flags of one duel row `d`. */
const IS_TEST = "(case when json_valid(d.setup_json) then coalesce(json_extract(d.setup_json, '$.testDuel'), 0) else 0 end)";
const HAS_BOT = "exists(select 1 from duel_seats bs where bs.duel_id = d.id and bs.is_bot = 1)";
/** Epoch ms of a text timestamp in either stored shape. */
const MS = (column: string) => `cast(round((julianday(${column}) - 2440587.5) * 86400000) as integer)`;
const iso = (ms: number) => new Date(ms).toISOString();

type Bounds = { guild: string; floor: string; from: string; to: string; curFromMs: number; all: 0 | 1 };
const boundsOf = (guild: string, range: DuelRangeInfo, includeBots: boolean): Bounds => ({
  guild, floor: iso(range.previous.fromMs - DAY_MS), from: iso(range.previous.fromMs), to: iso(range.toMs), curFromMs: range.fromMs, all: includeBots ? 1 : 0,
});

const emptyEndings = (): DuelEndingCounts => ({ win: 0, surrender: 0, timeout: 0, idle: 0, interrupted: 0, draw: 0, cancelled: 0, running: 0 });
const emptyPeriod = (): DuelPeriodStats => ({
  total: 0, byFormat: { "1v1": 0, ffa3: 0, ffa4: 0, tag: 0, remote: 0 }, byCardFormat: { domain: 0, genesys: 0, genesysDomain: 0, normal: 0 },
  endings: emptyEndings(), players: { unique: 0, new: 0, returning: 0 }, avgTurns: null, avgMinutes: null, practice: 0, test: 0,
  signups: 0, waitlistJoins: 0, bugReports: 0, replayChecksFailed: 0,
});

type EngineGroup = {
  p: 0 | 1; format: string; mode: string; genesys: number; ending: keyof DuelEndingCounts; is_test: number; has_bot: number; n: number;
  turns_sum: number | null; turns_n: number; minutes_sum: number | null; minutes_n: number;
};

function engineGroups(db: Database.Database, b: Bounds): EngineGroup[] {
  return db.prepare(`
    with base as (
      select case when ${MS("d.started_at")} >= @curFromMs then 1 else 0 end as p, d.format, d.mode, d.status, d.turn_count, d.started_at, d.ended_at,
        case when json_valid(d.settings_json) and json_extract(d.settings_json, '$.genesys') is not null then 1 else 0 end as genesys,
        case d.status
          when 'completed' then case when d.winner_seat is null then 'draw' when d.result_reason = 'Surrender' then 'surrender'
            when d.result_reason = 'Time limit' then 'timeout' else 'win' end
          when 'interrupted' then case when d.result_reason = @idle then 'idle' else 'interrupted' end
          when 'cancelled' then 'cancelled' else 'running' end as ending,
        ${IS_TEST} as is_test, ${HAS_BOT} as has_bot
      from duels d
      where d.guild_id = @guild and d.kind = 'play' and d.started_at is not null
        and julianday(coalesce(d.ended_at, d.created_at)) >= julianday(@floor)
        and julianday(d.started_at) >= julianday(@from) and julianday(d.started_at) < julianday(@to))
    select p, format, mode, genesys, ending, is_test, has_bot, count(*) as n,
      sum(case when status = 'completed' then turn_count end) as turns_sum, count(case when status = 'completed' then turn_count end) as turns_n,
      sum(case when status = 'completed' and ended_at is not null then (julianday(ended_at) - julianday(started_at)) * 1440 end) as minutes_sum,
      count(case when status = 'completed' and ended_at is not null then 1 end) as minutes_n
    from base group by p, format, mode, genesys, ending, is_test, has_bot`).all({ ...b, idle: DUEL_LIVE_IDLE_REASON }) as EngineGroup[];
}

/** Start times (epoch ms) of the counted engine duels of the current period. */
function engineStarts(db: Database.Database, b: Bounds, curTo: string): number[] {
  const rows = db.prepare(`
    select ${MS("d.started_at")} as ms from duels d
    where d.guild_id = @guild and d.kind = 'play' and d.started_at is not null
      and julianday(coalesce(d.ended_at, d.created_at)) >= julianday(@floor)
      and julianday(d.started_at) >= julianday(@curFrom) and julianday(d.started_at) < julianday(@to)
      and (@all = 1 or (${IS_TEST} = 0 and not ${HAS_BOT}))`)
    .all({ guild: b.guild, floor: b.floor, curFrom: iso(b.curFromMs), to: curTo, all: b.all }) as { ms: number }[];
  return rows.map((row) => row.ms);
}

type RemoteGroup = { p: 0 | 1; has_bot: number; n: number };
function remoteGroups(db: Database.Database, guild: string, range: DuelRangeInfo): RemoteGroup[] {
  return db.prepare(`
    select case when t.started_at >= @curFromMs then 1 else 0 end as p,
      exists(select 1 from remote_bot_seats rb where rb.table_id = t.id) as has_bot, count(*) as n
    from remote_tables t
    where t.guild_id = @guild and t.started_at is not null and t.started_at >= @from and t.started_at < @to
    group by p, has_bot`).all({ guild, curFromMs: range.fromMs, from: range.previous.fromMs, to: range.toMs }) as RemoteGroup[];
}

function remoteStarts(db: Database.Database, guild: string, range: DuelRangeInfo, all: boolean): number[] {
  const rows = db.prepare(`
    select t.started_at as ms from remote_tables t
    where t.guild_id = @guild and t.started_at >= @from and t.started_at < @to
      and (@all = 1 or not exists(select 1 from remote_bot_seats rb where rb.table_id = t.id))`)
    .all({ guild, from: range.fromMs, to: range.toMs, all: all ? 1 : 0 }) as { ms: number }[];
  return rows.map((row) => row.ms);
}

type PlayerRow = { first_ms: number; in_cur: number; in_prev: number };
/** One row per signed-in person seated in a counted duel in either period, with the first counted duel they ever started. */
function playerRows(db: Database.Database, b: Bounds, range: DuelRangeInfo): PlayerRow[] {
  return db.prepare(`
    select min(ms) as first_ms, max(ms >= @curFromMs and ms < @curToMs) as in_cur, max(ms >= @prevFromMs and ms < @prevToMs) as in_prev from (
      select pl.user_id as u, ${MS("d.started_at")} as ms
      from duel_seats s join players pl on pl.id = s.player_id join duels d on d.id = s.duel_id
      where s.is_bot = 0 and pl.user_id is not null and d.guild_id = @guild and d.kind = 'play' and d.started_at is not null
        and (@all = 1 or (${IS_TEST} = 0 and not ${HAS_BOT}))
      union all
      select rs.user_id as u, t.started_at as ms
      from remote_seats rs join remote_tables t on t.id = rs.table_id
      where t.guild_id = @guild and t.started_at is not null
        and (@all = 1 or not exists(select 1 from remote_bot_seats rb where rb.table_id = t.id)))
    group by u having in_cur = 1 or in_prev = 1`).all({
    guild: b.guild, all: b.all, curFromMs: range.fromMs, curToMs: range.toMs, prevFromMs: range.previous.fromMs, prevToMs: range.previous.toMs,
  }) as PlayerRow[];
}

/** One count over [from, to) in epoch ms. The SQL reads @from/@to (integer ms) or @fromIso/@toIso (text columns). */
function countIn(db: Database.Database, sql: string, args: Record<string, unknown>, from: number, to: number): number {
  const row = db.prepare(sql).get({ ...args, from, to, fromIso: iso(from), toIso: iso(to) }) as { n: number };
  return row.n;
}

export function loadDuelStats(db: Database.Database, guild: string, range: DuelRangeInfo, includeBots: boolean): DuelStatsData {
  const b = boundsOf(guild, range, includeBots);
  const current = emptyPeriod();
  const previous = emptyPeriod();
  const sums = [{ turns: 0, turnsN: 0, minutes: 0, minutesN: 0 }, { turns: 0, turnsN: 0, minutes: 0, minutesN: 0 }];
  const periods = [previous, current];

  for (const g of engineGroups(db, b)) {
    const period = periods[g.p];
    if (g.is_test === 1) period.test += g.n;
    else if (g.has_bot === 1) period.practice += g.n;
    if (!includeBots && (g.is_test === 1 || g.has_bot === 1)) continue;
    period.total += g.n;
    const format = g.format === "tag" || g.format === "ffa3" || g.format === "ffa4" ? g.format : "1v1";
    period.byFormat[format] += g.n;
    const domain = g.mode === "domain";
    period.byCardFormat[domain && g.genesys ? "genesysDomain" : domain ? "domain" : g.genesys ? "genesys" : "normal"] += g.n;
    period.endings[g.ending] += g.n;
    const sum = sums[g.p];
    sum.turns += g.turns_sum ?? 0; sum.turnsN += g.turns_n; sum.minutes += g.minutes_sum ?? 0; sum.minutesN += g.minutes_n;
  }
  for (const g of remoteGroups(db, guild, range)) {
    const period = periods[g.p];
    if (g.has_bot === 1) period.practice += g.n;
    if (!includeBots && g.has_bot === 1) continue;
    period.total += g.n;
    period.byFormat.remote += g.n;
  }
  periods.forEach((period, i) => {
    period.avgTurns = sums[i].turnsN > 0 ? sums[i].turns / sums[i].turnsN : null;
    period.avgMinutes = sums[i].minutesN > 0 ? sums[i].minutes / sums[i].minutesN : null;
  });

  for (const row of playerRows(db, b, range)) {
    const sides: [DuelPeriodStats, number, number][] = [[current, row.in_cur, range.fromMs], [previous, row.in_prev, range.previous.fromMs]];
    for (const [period, inside, from] of sides) {
      if (inside !== 1) continue;
      period.players.unique += 1;
      if (row.first_ms >= from) period.players.new += 1; else period.players.returning += 1;
    }
  }

  const spans: [DuelPeriodStats, number, number][] = [[current, range.fromMs, range.toMs], [previous, range.previous.fromMs, range.previous.toMs]];
  for (const [period, from, to] of spans) {
    period.signups = countIn(db, "select count(*) as n from users where first_sign_in_at >= @from and first_sign_in_at < @to", {}, from, to);
    period.waitlistJoins = countIn(db, `select count(*) as n from join_request_notifications
      where kind = 'join' and julianday(attempted_at) >= julianday(@fromIso) and julianday(attempted_at) < julianday(@toIso)`, {}, from, to);
    period.bugReports = countIn(db, `select count(*) as n from bug_reports
      where guild_id = @guild and julianday(created_at) >= julianday(@fromIso) and julianday(created_at) < julianday(@toIso)`, { guild }, from, to);
    period.replayChecksFailed = countIn(db, `select count(distinct v.duel_id) as n from duel_replay_verifications v join duels d on d.id = v.duel_id
      where d.guild_id = @guild and v.result = 'unverified'
        and julianday(v.checked_at) >= julianday(@fromIso) and julianday(v.checked_at) < julianday(@toIso)`, { guild }, from, to);
  }

  const starts = [...engineStarts(db, b, iso(range.toMs)), ...remoteStarts(db, guild, range, includeBots)];
  const perDayMap = new Map<string, number>();
  const perHour = Array.from({ length: 24 }, () => 0);
  for (const ms of starts) {
    const day = easternDayKey(ms);
    perDayMap.set(day, (perDayMap.get(day) ?? 0) + 1);
    perHour[easternHour(ms)] += 1;
  }
  const perDay = Array.from({ length: range.days }, (_, i) => { const day = addDays(range.from, i); return { day, n: perDayMap.get(day) ?? 0 }; });
  return { timezone: "America/New_York", range, includeBots, current, previous, perDay, perHour };
}

/** GET /api/admin/console/duel-stats?range=today|7d|30d | ?from=&to=, &bots=1 to count practice-bot and test duels. */
export async function duelStatsResponse(request: Request): Promise<Response> {
  const gate = await adminGate();
  if (!gate.ok) return gate.response;
  const now = Date.now();
  const guild = env.discordGuildId;
  if (!guild) return adminJson(notConfigured("Set DISCORD_GUILD_ID to count the duels.", now));
  const query = new URL(request.url).searchParams;
  const range = resolveDuelRange(query, now);
  if (!range.ok) return adminJson(failed(range.message, now), 400);
  try {
    return adminJson(ok(loadDuelStats(getDb(), guild, range.range, query.get("bots") === "1"), now));
  } catch {
    return adminJson(failed("The duel stats could not be read from the database.", now));
  }
}
