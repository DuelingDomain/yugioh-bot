import type Database from "better-sqlite3";
import { DUEL_WAITING_IDLE_TIMEOUT_MS } from "@yugidraft/shared/duels";
import { DUEL_LIVE_IDLE_AFTER_MS } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { failed, notConfigured, ok, type SectionLoader } from "./section";
import type { LiveData, LiveDraft, LiveDuel, LiveDuelFormat } from "./types";

const FORMAT_LABEL: Record<LiveDuelFormat, string> = { "1v1": "1v1 duel", tag: "Tag duel", ffa3: "3-way duel", ffa4: "4-way duel" };
const PRACTICE_BOT_NAME = "Practice Bot";
const MAX_ROWS = 100;
/** A table that waits for its first draft pick this long is treated as abandoned. */
const PENDING_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Database timestamps are text in two shapes: SQLite `datetime('now')` ("2026-10-19 12:00:00", UTC)
 * and ISO strings from the app ("2026-10-19T12:00:00.000Z"). Both mean UTC.
 */
export function dbTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const ms = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms : null;
}

type DuelRow = {
  id: number; web_slug: string; name: string; status: "lobby" | "active"; format: string; ranked: number;
  genesys: number; created_at: string; started_at: string | null; activity_at: string | null; seat_count: number;
};

function isFormat(value: string): value is LiveDuelFormat {
  return value === "1v1" || value === "tag" || value === "ffa3" || value === "ffa4";
}

function liveDuels(db: Database.Database, guild: string, now: number): LiveDuel[] {
  // Index: duels_guild_status_idx (guild_id, status). Only open tables are read.
  const rows = db.prepare(`
    select d.id, d.web_slug, d.name, d.status, d.format, d.ranked, d.created_at, d.started_at,
      coalesce(d.last_activity_at, d.started_at, d.created_at) as activity_at,
      json_extract(d.settings_json, '$.genesys') is not null as genesys,
      (select count(*) from duel_seats s where s.duel_id = d.id) as seat_count
    from duels d
    where d.guild_id = ? and d.status in ('lobby', 'active') and d.kind = 'play' and d.archived_at is null
    order by d.id desc limit 500`).all(guild) as DuelRow[];
  // Same cut-offs the duel host uses: an active duel closes after 10 minutes without input,
  // a waiting table after the lobby timeout. Rows past them are about to be closed, so they are not live.
  const open = rows.filter((row) => {
    const activity = dbTimeMs(row.activity_at) ?? 0;
    if (row.status === "active") return now - activity <= DUEL_LIVE_IDLE_AFTER_MS;
    return row.seat_count > 0 && now - activity <= DUEL_WAITING_IDLE_TIMEOUT_MS;
  }).slice(0, MAX_ROWS);
  if (open.length === 0) return [];

  const seatRows = db.prepare(`
    select s.duel_id, s.is_bot, p.display_name
    from duel_seats s left join players p on p.id = s.player_id
    where s.duel_id in (select value from json_each(?))
    order by s.duel_id, s.seat`).all(JSON.stringify(open.map((row) => row.id))) as
    { duel_id: number; is_bot: number; display_name: string | null }[];
  const players = new Map<number, string[]>();
  for (const seat of seatRows) {
    const list = players.get(seat.duel_id) ?? [];
    list.push(seat.is_bot ? PRACTICE_BOT_NAME : (seat.display_name ?? "Player"));
    players.set(seat.duel_id, list);
  }

  const duels = open.map((row): LiveDuel => {
    const format: LiveDuelFormat = isFormat(row.format) ? row.format : "1v1";
    const createdAt = dbTimeMs(row.created_at) ?? now;
    return {
      slug: row.web_slug, name: row.name, format, formatLabel: FORMAT_LABEL[format], status: row.status,
      players: players.get(row.id) ?? [],
      startedAt: row.status === "active" ? (dbTimeMs(row.started_at) ?? createdAt) : null,
      createdAt, ranked: row.ranked === 1, genesys: row.genesys === 1,
      watchHref: `/duels/${row.web_slug}`,
    };
  });
  // Running duels first, newest first inside each group.
  const sinceOf = (duel: LiveDuel) => duel.startedAt ?? duel.createdAt ?? 0;
  return duels.sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || sinceOf(b) - sinceOf(a));
}

type DraftRow = {
  id: number; web_slug: string; name: string; status: "pending" | "active"; created_at: string; started_at: string | null;
  current_wave_number: number; current_pick_step: number;
};

function liveDrafts(db: Database.Database, guild: string, now: number): LiveDraft[] {
  // Index: drafts_guild_status_created_idx (guild_id, status, created_at).
  const rows = db.prepare(`
    select id, web_slug, name, status, created_at, started_at, current_wave_number, current_pick_step
    from drafts
    where guild_id = ? and status in ('pending', 'active') and web_slug is not null
    order by id desc limit 200`).all(guild) as DraftRow[];
  const open = rows.filter((row) => row.status === "active" || now - (dbTimeMs(row.created_at) ?? now) <= PENDING_DRAFT_MAX_AGE_MS).slice(0, MAX_ROWS);
  if (open.length === 0) return [];

  const playerRows = db.prepare(`
    select dp.draft_id, p.display_name
    from draft_players dp join players p on p.id = dp.player_id
    where dp.draft_id in (select value from json_each(?))
    order by dp.draft_id, coalesce(dp.seat_index, 1000), dp.joined_at`).all(JSON.stringify(open.map((row) => row.id))) as
    { draft_id: number; display_name: string }[];
  const players = new Map<number, string[]>();
  for (const row of playerRows) players.set(row.draft_id, [...(players.get(row.draft_id) ?? []), row.display_name]);

  return open.map((row): LiveDraft => ({
    slug: row.web_slug, name: row.name, status: row.status, players: players.get(row.id) ?? [],
    startedAt: row.status === "active" ? (dbTimeMs(row.started_at) ?? dbTimeMs(row.created_at)) : null,
    createdAt: dbTimeMs(row.created_at) ?? now,
    progress: row.status === "active" && row.current_wave_number > 0 ? `Round ${row.current_wave_number}, pick ${row.current_pick_step}` : null,
    href: `/draft/${row.web_slug}`,
  }));
}

/**
 * Open duel tables and drafts from the shared SQLite file, scoped to the configured guild. "Live" means the
 * duel is `active` and not past the idle cut-off; lobbies are listed too with status "lobby", so the summary
 * strip counts only status "active". Replay forks are not duels people play, so they are left out.
 */
export const loadLive: SectionLoader<"live"> = async ({ now }) => {
  const guild = env.discordGuildId;
  if (!guild) return notConfigured("Set DISCORD_GUILD_ID to list live duels and drafts.", now);
  try {
    const db = getDb();
    const data: LiveData = { duels: liveDuels(db, guild, now), drafts: liveDrafts(db, guild, now) };
    return ok(data, now);
  } catch {
    return failed("Live duels and drafts could not be read from the database.", now);
  }
};
