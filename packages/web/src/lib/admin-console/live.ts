import type Database from "better-sqlite3";
import { safeAvatarUrl } from "@yugidraft/shared/admin";
import { TEST_BOT_DISCORD_PREFIX } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { failed, notConfigured, ok, type SectionLoader } from "./section";
import type { LiveData, LiveDraft, LiveDuel, LiveDuelFormat, LiveSeat } from "./types";

export const FORMAT_LABEL: Record<LiveDuelFormat, string> = { "1v1": "1v1 duel", tag: "Tag duel", ffa3: "3-way duel", ffa4: "4-way duel" };
const PRACTICE_BOT_NAME = "Practice Bot";
/** Main-round picks per player when the draft config does not say. */
const DEFAULT_PICKS = 40;

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

export const safeInt = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

type DuelRow = {
  id: number; web_slug: string; name: string; status: "lobby" | "active"; format: string; ranked: number;
  genesys: number; created_at: string; started_at: string | null; activity_at: string | null; seat_count: number;
  turn: number | null; active_seat: number | null; visibility: "public" | "private"; mode: string;
};
type SeatRow = { duel_id: number; is_bot: number; display_name: string | null; user_id: number | null; image_url: string | null };

export function isFormat(value: string): value is LiveDuelFormat {
  return value === "1v1" || value === "tag" || value === "ffa3" || value === "ffa4";
}

/** One query for the seats of many duels: name, picture and bot flag, seat order. */
export function seatsOf(db: Database.Database, duelIds: number[]): Map<number, LiveSeat[]> {
  const seats = new Map<number, LiveSeat[]>();
  if (duelIds.length === 0) return seats;
  const rows = db.prepare(`
    select s.duel_id, s.is_bot, p.display_name, p.user_id, u.image_url
    from duel_seats s left join players p on p.id = s.player_id left join users u on u.id = p.user_id
    where s.duel_id in (select value from json_each(?))
    order by s.duel_id, s.seat`).all(JSON.stringify(duelIds)) as SeatRow[];
  for (const row of rows) {
    const list = seats.get(row.duel_id) ?? [];
    list.push(row.is_bot
      ? { name: PRACTICE_BOT_NAME, avatarUrl: null, bot: true, userId: null }
      : { name: row.display_name ?? "Player", avatarUrl: safeAvatarUrl(row.image_url), bot: false, userId: row.user_id });
    seats.set(row.duel_id, list);
  }
  return seats;
}

function liveDuels(db: Database.Database, guild: string, now: number): LiveDuel[] {
  // Index: duels_guild_status_idx (guild_id, status). Only open tables are read. clock_json is a few dozen bytes
  // ({ turn, remainingMs, activeSeat, startedAt }), so reading the turn from it is cheap; board snapshots are never read.
  const rows = db.prepare(`
    select d.id, d.web_slug, d.name, d.status, d.format, d.ranked, d.mode,
      coalesce(json_extract(d.settings_json, '$.visibility'), 'public') as visibility, d.created_at, d.started_at,
      coalesce(d.last_activity_at, d.started_at, d.created_at) as activity_at,
      json_extract(d.settings_json, '$.genesys') is not null as genesys,
      (select count(*) from duel_seats s where s.duel_id = d.id) as seat_count,
      case when json_valid(d.clock_json) then json_extract(d.clock_json, '$.turn') end as turn,
      case when json_valid(d.clock_json) then json_extract(d.clock_json, '$.activeSeat') end as active_seat
    from duels d
    where d.guild_id = ? and d.status in ('lobby', 'active') and d.kind = 'play' and d.archived_at is null
    order by d.id desc`).all(guild) as DuelRow[];
  // An overdue persisted active table is still watchable until the host actually closes it.
  const open = rows;
  if (open.length === 0) return [];

  const seats = seatsOf(db, open.map((row) => row.id));
  const duels = open.map((row): LiveDuel => {
    const format: LiveDuelFormat = isFormat(row.format) ? row.format : "1v1";
    const createdAt = dbTimeMs(row.created_at) ?? now;
    const tableSeats = seats.get(row.id) ?? [];
    const activeSeat = safeInt(row.active_seat);
    return {
      slug: row.web_slug, name: row.name, format, formatLabel: FORMAT_LABEL[format], status: row.status,
      players: tableSeats.map((seat) => seat.name),
      startedAt: row.status === "active" ? (dbTimeMs(row.started_at) ?? createdAt) : null,
      createdAt, ranked: row.ranked === 1, genesys: row.genesys === 1,
      watchHref: `/admin/watch/duel/${row.web_slug}`, visibility: row.visibility, modeLabel: row.mode === "domain" ? "Domain" : "Standard",
      seats: tableSeats,
      turn: row.status === "active" ? safeInt(row.turn) : null,
      activeSeat: row.status === "active" && activeSeat !== null && activeSeat < tableSeats.length ? activeSeat : null,
      lastActivityAt: dbTimeMs(row.activity_at),
    };
  });
  // Running duels first, newest first inside each group.
  const sinceOf = (duel: LiveDuel) => duel.startedAt ?? duel.createdAt ?? 0;
  return duels.sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || sinceOf(b) - sinceOf(a));
}

type DraftRow = {
  id: number; web_slug: string; name: string; status: "pending" | "active"; created_at: string; started_at: string | null;
  visibility: "open" | "private"; current_wave_number: number; current_pick_step: number; mode: string | null; cube_name: unknown; cards_per_player: unknown;
};
type DraftPlayerRow = { draft_id: number; display_name: string; user_id: number | null; discord_user_id: string | null; image_url: string | null; pick_count: number };

function liveDrafts(db: Database.Database, guild: string, now: number): LiveDraft[] {
  // Index: drafts_guild_status_created_idx (guild_id, status, created_at).
  const rows = db.prepare(`
    select id, web_slug, name, status, created_at, started_at, visibility, current_wave_number, current_pick_step,
      case when json_valid(config_json) then json_extract(config_json, '$.mode') end as mode,
      case when json_valid(config_json) then json_extract(config_json, '$.poolSource.cubeName') end as cube_name,
      case when json_valid(config_json) then json_extract(config_json, '$.cardsPerPlayer') end as cards_per_player
    from drafts
    where guild_id = ? and status in ('pending', 'active') and web_slug is not null
    order by id desc`).all(guild) as DraftRow[];
  const open = rows;
  if (open.length === 0) return [];

  const playerRows = db.prepare(`
    select dp.draft_id, p.display_name, p.user_id, p.discord_user_id, u.image_url, dp.pick_count
    from draft_players dp join players p on p.id = dp.player_id left join users u on u.id = p.user_id
    where dp.draft_id in (select value from json_each(?))
    order by dp.draft_id, coalesce(dp.seat_index, 1000), dp.joined_at`).all(JSON.stringify(open.map((row) => row.id))) as DraftPlayerRow[];
  const seats = new Map<number, LiveSeat[]>();
  const picks = new Map<number, number>();
  for (const row of playerRows) {
    const bot = typeof row.discord_user_id === "string" && row.discord_user_id.startsWith(TEST_BOT_DISCORD_PREFIX);
    seats.set(row.draft_id, [...(seats.get(row.draft_id) ?? []), {
      name: row.display_name, avatarUrl: bot ? null : safeAvatarUrl(row.image_url), bot, userId: bot ? null : row.user_id,
    }]);
    picks.set(row.draft_id, Math.max(picks.get(row.draft_id) ?? 0, row.pick_count));
  }

  return open.map((row): LiveDraft => {
    const draftSeats = seats.get(row.id) ?? [];
    const target = typeof row.cards_per_player === "number" && Number.isSafeInteger(row.cards_per_player) && row.cards_per_player > 0 ? row.cards_per_player : DEFAULT_PICKS;
    return {
      slug: row.web_slug, name: row.name, status: row.status, players: draftSeats.map((seat) => seat.name),
      startedAt: row.status === "active" ? (dbTimeMs(row.started_at) ?? dbTimeMs(row.created_at)) : null,
      createdAt: dbTimeMs(row.created_at) ?? now,
      progress: row.status === "active" && row.current_wave_number > 0 ? `Round ${row.current_wave_number}, pick ${row.current_pick_step}` : null,
      href: `/admin/watch/draft/${row.web_slug}`, visibility: row.visibility,
      seats: draftSeats,
      modeLabel: row.mode === "theme" ? "Theme" : typeof row.cube_name === "string" && row.cube_name.trim() ? "Cube" : "Booster",
      cubeName: typeof row.cube_name === "string" && row.cube_name.trim() ? row.cube_name.trim().slice(0, 80) : null,
      picksMade: Math.min(picks.get(row.id) ?? 0, target),
      picksTotal: target,
    };
  });
}

/**
 * Open duel tables and drafts from the shared SQLite file, scoped to the configured guild. "Live" means the
 * duel is persisted as `active`; lobbies are listed too with status "lobby". Replay forks
 * are not duels people play, so they are left out. Duels that started today are in the "today" section.
 */
export const loadLive: SectionLoader<"live"> = async ({ now }) => {
  const guild = env.discordGuildId;
  if (!guild) return notConfigured("Set DISCORD_GUILD_ID to list live duels and drafts.", now);
  try {
    const db = getDb();
    // Running tables first, the longest-running at the top; lobbies after them, newest first.
    const started = (row: { status: string; startedAt: number | null; createdAt?: number }) => (row.status === "active" ? row.startedAt ?? row.createdAt ?? 0 : null);
    const byAge = <T extends { status: string; startedAt: number | null; createdAt?: number }>(a: T, b: T) => {
      const sa = started(a), sb = started(b);
      if (sa !== null && sb !== null) return sa - sb;
      if (sa !== null || sb !== null) return sa !== null ? -1 : 1;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    };
    const data: LiveData = {
      duels: liveDuels(db, guild, now).sort(byAge), drafts: liveDrafts(db, guild, now).sort(byAge),
    };
    return ok(data, now);
  } catch {
    return failed("Live duels and drafts could not be read from the database.", now);
  }
};
