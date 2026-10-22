import type Database from "better-sqlite3";
import { DUEL_WAITING_IDLE_TIMEOUT_MS } from "@yugidraft/shared/duels";
import { FORMAT_LABEL, type Format } from "./common.js";
import { PRESENCE_ROUTES, isPresenceRoute } from "./presence-routes.js";

// Definitions copied from origin/feat/admin-console-live-stats (5a2bfb54f).
// The console's DUEL_LIVE_IDLE_AFTER_MS is 10 minutes; avoid the heavy services barrel.
export const DUEL_LIVE_IDLE_AFTER_MS = 10 * 60 * 1000;
// Use the site's 24-hour abandoned-lobby window to bound long-running activity too.
export const LIVE_EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STAT_KEYS = ["signups", "activeUsers", "duelsStarted", "duelsFinished", "draftsStarted", "draftsCompleted"] as const;
type StatKey = typeof STAT_KEYS[number];
export type StatsData = { timezone: "UTC"; days: string[]; series: Record<StatKey, number[]>;
  today: Record<StatKey, number>; last7Days: Record<StatKey, number> };
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 7;
export function dbTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const ms = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms : null;
}
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayOf = (text: string | null) => { const ms = dbTimeMs(text); return ms === null ? null : utcDay(ms); };

export function hasPresence(db: Database.Database, route = false): boolean {
  const columns = new Set((db.prepare("pragma table_info(users)").all() as { name: string }[]).map(row => row.name));
  return columns.has("last_seen_at") && (!route || columns.has("last_route"));
}

export interface OnlineUser { userId: number; name: string; label: string; lastSeenAt: number }
export function listOnline(db: Database.Database, now: number, guild: string) {
  if (!hasPresence(db, true)) return null;
  const rows = db.prepare(`select id,display_name,username,last_seen_at,last_route from users
    where last_seen_at >= ? order by last_seen_at desc limit 500`).all(now - 120_000) as
    { id: number; display_name: string; username: string; last_seen_at: number; last_route: string | null }[];
  const duelLabel = db.prepare(`select d.status,d.format from duels d
    join duel_seats s on s.duel_id=d.id join players p on p.id=s.player_id
    where p.user_id=@user and d.guild_id=@guild and p.guild_id=@guild and s.is_bot=0
      and d.status in ('lobby','active') and d.kind='play' and d.archived_at is null
      and case when json_valid(d.setup_json) then coalesce(json_extract(d.setup_json,'$.testDuel'),0) else 0 end=0
      and julianday(coalesce(d.last_activity_at,d.started_at,d.created_at)) >=
        julianday(case when d.status='active' then @activeAfter else @waitingAfter end)
      and not exists (select 1 from duel_kicked_players k where k.duel_id=d.id and k.player_id=s.player_id)
      and not exists (select 1 from json_each(case when json_valid(d.setup_json) then d.setup_json end,'$.eliminatedSeats') gone where gone.value=s.seat)
      and not exists (select 1 from json_each(case when json_valid(d.setup_json) then d.setup_json end,'$.surrenderedSeats') gone where gone.value=s.seat
        and not exists (select 1 from duel_commands c where c.duel_id=d.id and c.seat=s.seat
          and json_extract(c.command_json,'$.promptId') glob 'eliminate-eot:*'))
      and not exists (select 1 from duel_commands c where c.duel_id=d.id and c.seat=s.seat
        and json_extract(c.command_json,'$.promptId') glob 'eliminate:*')
    order by d.id desc limit 1`);
  const activity = { guild, activeAfter: new Date(now-DUEL_LIVE_IDLE_AFTER_MS).toISOString(),
    waitingAfter: new Date(now-DUEL_WAITING_IDLE_TIMEOUT_MS).toISOString() };
  const users: OnlineUser[] = rows.map(row => {
    const route = isPresenceRoute(row.last_route) ? row.last_route : "/app";
    const duel = route === "/duels/[slug]" ? duelLabel.get({ ...activity, user: row.id }) as { status: string; format: string } | undefined : undefined;
    const label = duel ? duel.status === "lobby" ? "Duel lobby" : FORMAT_LABEL[duel.format as Format] ?? "Duel" : route === "/duels/[slug]" ? "Duel page" : PRESENCE_ROUTES[route];
    return { userId: row.id, name: row.display_name || row.username, label, lastSeenAt: row.last_seen_at };
  });
  const groups = new Map<string, number>();
  for (const user of users) groups.set(user.label, (groups.get(user.label) ?? 0) + 1);
  const bySection = [...groups].map(([label,count]) => ({ label,count })).sort((a,b) => b.count-a.count || a.label.localeCompare(b.label));
  return { count: users.length, windowSeconds: 120, users, bySection };
}

/** Site live-table rules, plus a 24-hour age limit for abandoned active drafts. */
export function liveCounts(db: Database.Database, guild: string, now: number) {
  const rows = db.prepare(`select d.id,d.status,d.format,d.created_at,d.started_at,
    coalesce(d.last_activity_at,d.started_at,d.created_at) as activity_at,
    (select count(*) from duel_seats s where s.duel_id=d.id) as seat_count
    from duels d where d.guild_id=? and d.status in ('lobby','active') and d.kind='play' and d.archived_at is null
    and case when json_valid(d.setup_json) then coalesce(json_extract(d.setup_json,'$.testDuel'),0) else 0 end=0
    order by d.id desc limit 500`).all(guild) as
    { status: string; format: string; activity_at: string | null; seat_count: number }[];
  const open = rows.filter(row => row.status === "active" ? now - (dbTimeMs(row.activity_at) ?? 0) <= DUEL_LIVE_IDLE_AFTER_MS
    : row.seat_count > 0 && now - (dbTimeMs(row.activity_at) ?? 0) <= DUEL_WAITING_IDLE_TIMEOUT_MS).slice(0,100);
  const duels = { "1v1": 0, tag: 0, ffa3: 0, ffa4: 0 };
  let lobbies = 0;
  for (const row of open) {
    if (row.status === "lobby") { lobbies++; continue; }
    const format = Object.hasOwn(FORMAT_LABEL,row.format) ? row.format as Format : "1v1";
    duels[format]++;
  }
  const liveDrafts = db.prepare(`select status from drafts
    where guild_id=? and status in ('pending','active') and web_slug is not null
      and julianday(case when status='active' then coalesce(started_at,created_at) else created_at end) >= julianday(?)
    order by id desc limit 100`).all(guild,new Date(now-LIVE_EVENT_MAX_AGE_MS).toISOString()) as
    { status: string }[];
  return { duels, lobbies, drafts: { active: liveDrafts.filter(row => row.status === "active").length,
    waiting: liveDrafts.filter(row => row.status === "pending").length } };
}

/** Seven UTC days. Daily users are sets; weekly users are their union. Latest presence cannot reconstruct past visits. */
export function computeStats(db: Database.Database, guild: string, now: number): StatsData {
  const days = Array.from({ length: DAYS }, (_, i) => utcDay(now - (DAYS - 1 - i) * DAY_MS));
  const from = days[0];
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const index = new Map(days.map((day, i) => [day, i]));
  const series = Object.fromEntries(STAT_KEYS.map((key) => [key, days.map(() => 0)])) as Record<StatKey, number[]>;
  const bump = (key: StatKey, day: string | null) => {
    const i = day === null ? undefined : index.get(day);
    if (i !== undefined) series[key][i] += 1;
  };
  const active = days.map(() => new Set<number>());
  const mark = (day: string | null, userId: number | null) => {
    const i = day === null ? undefined : index.get(day);
    if (i !== undefined && userId !== null) active[i].add(userId);
  };

  for (const row of db.prepare("select created_at from users where created_at >= ?").all(from) as { created_at: string }[]) {
    bump("signups", dayOf(row.created_at));
  }

  const duels = db.prepare(`
    select id, status, created_at, started_at, ended_at from duels
    where guild_id = ? and kind = 'play' and julianday(coalesce(ended_at, created_at)) >= julianday(?)`).all(guild, from) as
    { id: number; status: string; created_at: string; started_at: string | null; ended_at: string | null }[];
  const startedDay = new Map<number, string>();
  for (const duel of duels) {
    // A table that closed in its lobby never started; a started duel always has started_at or a started status.
    const started = duel.started_at !== null || duel.status === "active" || duel.status === "completed" || duel.status === "interrupted";
    const day = started ? dayOf(duel.started_at ?? duel.created_at) : null;
    if (day !== null) { startedDay.set(duel.id, day); bump("duelsStarted", day); }
    if (duel.status === "completed") bump("duelsFinished", dayOf(duel.ended_at));
  }
  if (startedDay.size > 0) {
    const seats = db.prepare(`
      select s.duel_id, p.user_id from duel_seats s join players p on p.id = s.player_id
      where s.is_bot = 0 and p.user_id is not null and s.duel_id in (select value from json_each(?))`)
      .all(JSON.stringify([...startedDay.keys()])) as { duel_id: number; user_id: number }[];
    for (const seat of seats) mark(startedDay.get(seat.duel_id) ?? null, seat.user_id);
  }

  const drafts = db.prepare(`
    select id, status, started_at, ended_at from drafts
    where guild_id = ? and (started_at >= ? or ended_at >= ?)`).all(guild, from, from) as
    { id: number; status: string; started_at: string | null; ended_at: string | null }[];
  const draftDay = new Map<number, string>();
  for (const draft of drafts) {
    const day = dayOf(draft.started_at);
    if (day !== null && index.has(day)) { draftDay.set(draft.id, day); bump("draftsStarted", day); }
    if (draft.status === "completed") bump("draftsCompleted", dayOf(draft.ended_at));
  }
  if (draftDay.size > 0) {
    const players = db.prepare(`
      select dp.draft_id, p.user_id from draft_players dp join players p on p.id = dp.player_id
      where p.user_id is not null and dp.draft_id in (select value from json_each(?))`)
      .all(JSON.stringify([...draftDay.keys()])) as { draft_id: number; user_id: number }[];
    for (const player of players) mark(draftDay.get(player.draft_id) ?? null, player.user_id);
  }

  if (hasPresence(db)) for (const row of db.prepare("select id, last_seen_at from users where last_seen_at >= ?").all(fromMs) as { id: number; last_seen_at: number }[]) {
    mark(utcDay(row.last_seen_at), row.id);
  }
  series.activeUsers = active.map((set) => set.size);

  const last = DAYS - 1;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const today = {} as Record<StatKey, number>;
  const last7Days = {} as Record<StatKey, number>;
  for (const key of STAT_KEYS) { today[key] = series[key][last]; last7Days[key] = sum(series[key]); }
  // A person active on several days is one active user for the week.
  last7Days.activeUsers = new Set(active.flatMap((set) => [...set])).size;
  return { timezone: "UTC", days, series, today, last7Days };
}
