import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { dbTimeMs } from "./live";
import { failed, notConfigured, ok, type SectionLoader } from "./section";
import { STAT_KEYS, type StatKey, type StatsData } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 7;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayOf = (text: string | null) => { const ms = dbTimeMs(text); return ms === null ? null : utcDay(ms); };

/**
 * Seven UTC days ending today (and the seven before, for the week-on-week change), counted from the shared SQLite file. Every query is bounded by the oldest day:
 *  - sign-ups: users.first_sign_in_at, the epoch ms of a person's first web sign-in. users.created_at is not used: it also
 *    covers Discord-only rows and test players that never signed in. A small, narrow table, scanned once per poll; no index added.
 *  - duels: the existing partial index duels_play_history_idx, (guild_id, julianday(coalesce(ended_at, created_at))) where kind = 'play'.
 *    The range covers every duel created or ended in the window. Replay forks are never counted.
 *  - drafts: drafts_guild_status_created_idx narrows to the guild; started_at/ended_at have no index, so those rows are
 *    filtered as they are read. One community guild has few drafts, and a new index would need a schema change for a
 *    60-second poll, so none was added.
 *  - presence: users_last_seen_idx.
 *
 * Active users = distinct users who, on that UTC day, were seated in a duel that started, took part in a draft
 * that started, or whose latest visit (users.last_seen_at) fell on that day. The database keeps only the LATEST
 * visit per user, so a past day counts a returning visitor only through their duel or draft play. Today is exact.
 */
export const loadStats: SectionLoader<"stats"> = async ({ now }) => {
  const guild = env.discordGuildId;
  if (!guild) return notConfigured("Set DISCORD_GUILD_ID to count duels and drafts.", now);
  try {
    return ok(computeStats(getDb(), guild, now), now);
  } catch {
    return failed("Stats could not be read from the database.", now);
  }
};

/** Counts over the last 14 UTC days: the 7 shown, and the 7 before them for "vs last week". */
const SPAN = DAYS * 2;

export function computeStats(db: Database.Database, guild: string, now: number): StatsData {
  const days = Array.from({ length: SPAN }, (_, i) => utcDay(now - (SPAN - 1 - i) * DAY_MS));
  const from = days[0];
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const index = new Map(days.map((day, i) => [day, i]));
  const series = Object.fromEntries(STAT_KEYS.map((key) => [key, days.map(() => 0)])) as Record<StatKey, number[]>;
  const bump = (key: StatKey, day: string | null) => {
    const i = day === null ? undefined : index.get(day);
    if (i !== undefined) series[key][i] += 1;
  };
  const active = days.map(() => new Set<string>());
  const mark = (day: string | null, userId: string | null) => {
    const i = day === null ? undefined : index.get(day);
    if (i !== undefined && userId !== null) active[i].add(userId);
  };

  // Sign-ups are not tracked on the local build (no users table), so that series stays at zero.

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
      select s.duel_id, p.discord_user_id user_id from duel_seats s join players p on p.id = s.player_id
      where s.is_bot = 0 and s.duel_id in (select value from json_each(?))`)
      .all(JSON.stringify([...startedDay.keys()])) as { duel_id: number; user_id: string }[];
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
      select dp.draft_id, p.discord_user_id user_id from draft_players dp join players p on p.id = dp.player_id
      where dp.draft_id in (select value from json_each(?))`)
      .all(JSON.stringify([...draftDay.keys()])) as { draft_id: number; user_id: string }[];
    for (const player of players) mark(draftDay.get(player.draft_id) ?? null, player.user_id);
  }

  for (const row of db.prepare("select discord_user_id, last_seen_at from admin_presence where last_seen_at >= ?").all(fromMs) as { discord_user_id: string; last_seen_at: number }[]) {
    mark(utcDay(row.last_seen_at), row.discord_user_id);
  }
  series.activeUsers = active.map((set) => set.size);

  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const shown = {} as Record<StatKey, number[]>;
  const today = {} as Record<StatKey, number>;
  const last7Days = {} as Record<StatKey, number>;
  const previous7Days = {} as Record<StatKey, number>;
  for (const key of STAT_KEYS) {
    shown[key] = series[key].slice(DAYS);
    today[key] = series[key][SPAN - 1];
    last7Days[key] = sum(shown[key]);
    previous7Days[key] = sum(series[key].slice(0, DAYS));
  }
  // A person active on several days is one active user for the week.
  const distinct = <T,>(sets: Set<T>[]) => new Set(sets.flatMap((set) => [...set])).size;
  last7Days.activeUsers = distinct(active.slice(DAYS));
  previous7Days.activeUsers = distinct(active.slice(0, DAYS));
  return { timezone: "UTC", days: days.slice(DAYS), series: shown, today, last7Days, previous7Days };
}
