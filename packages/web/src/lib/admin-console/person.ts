import type Database from "better-sqlite3";
import { FORMAT_LABEL, currentPlace, placesOf, safeAvatarUrl } from "@yugidraft/shared/admin";
import { teamOfSeat, type DuelFormat } from "@yugidraft/shared/duels";
import { ONLINE_WINDOW_MS, PRESENCE_ROUTES, isPresenceRoute } from "@yugidraft/shared/presence";
import { dbTimeMs } from "./live";
import type { PersonActivity, PersonDetail } from "./types";

const RECENT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

type UserRow = {
  id: number; display_name: string; username: string; image_url: string | null; last_seen_at: number | null;
  last_route: string | null; online_since: number | null; first_sign_in_at: number | null; created_at: string;
};
type DuelRow = {
  id: number; web_slug: string; name: string; status: string; format: string; seat: number; winner_seat: number | null;
  created_at: string; started_at: string | null; ended_at: string | null;
};
type DraftRow = { id: number; web_slug: string; name: string; status: string; created_at: string; started_at: string | null; ended_at: string | null };

function duelActivity(row: DuelRow): PersonActivity {
  const format = (row.format in FORMAT_LABEL ? row.format : "1v1") as DuelFormat;
  const base = { kind: "duel" as const, name: row.name, what: FORMAT_LABEL[format] };
  if (row.status === "active") return { ...base, href: `/duels/${row.web_slug}`, outcome: "Playing", tone: "live", at: dbTimeMs(row.started_at) ?? dbTimeMs(row.created_at) };
  if (row.status === "lobby") return { ...base, href: `/duels/${row.web_slug}`, outcome: "Lobby", tone: "quiet", at: dbTimeMs(row.created_at) };
  const at = dbTimeMs(row.ended_at) ?? dbTimeMs(row.created_at);
  const href = `/duels/${row.web_slug}/replay`;
  if (row.status === "completed" && row.winner_seat !== null) {
    const won = teamOfSeat(format, row.seat) === teamOfSeat(format, row.winner_seat);
    return { ...base, href, outcome: won ? "Won" : "Lost", tone: won ? "good" : "bad", at };
  }
  if (row.status === "completed") return { ...base, href, outcome: "Draw", tone: "quiet", at };
  return { ...base, href, outcome: row.status === "cancelled" ? "Cancelled" : "Ended early", tone: "quiet", at };
}

function draftActivity(row: DraftRow): PersonActivity {
  const outcome = row.status === "active" ? "Drafting" : row.status === "pending" ? "Lobby" : row.status === "completed" ? "Completed" : "Cancelled";
  const tone = row.status === "active" ? "live" : "quiet";
  return {
    kind: "draft", name: row.name, href: `/draft/${row.web_slug}`, what: "Draft", outcome, tone,
    at: dbTimeMs(row.ended_at) ?? dbTimeMs(row.started_at) ?? dbTimeMs(row.created_at),
  };
}

/**
 * One person for the People view: who they are, where they are now, a short history of duels and drafts in
 * the guild, and counts for the last 7 and 30 days. All reads use existing indexes: players_user_idx,
 * duel_seats_player_idx (player_id, duel_id) and draft_players_player_idx. Null when the user does not exist.
 */
export function loadPerson(db: Database.Database, guild: string, userId: number, now: number): PersonDetail | null {
  const user = db.prepare(`
    select id, display_name, username, image_url, last_seen_at, last_route, online_since, first_sign_in_at, created_at
    from users where id = ?`).get(userId) as UserRow | undefined;
  if (!user) return null;
  const route = isPresenceRoute(user.last_route) ? user.last_route : null;
  const online = user.last_seen_at !== null && user.last_seen_at >= now - ONLINE_WINDOW_MS;
  const playerIds = JSON.stringify((db.prepare("select id from players where user_id = ? and guild_id = ?").all(userId, guild) as { id: number }[]).map((row) => row.id));

  const duels = db.prepare(`
    select d.id, d.web_slug, d.name, d.status, d.format, s.seat, d.winner_seat, d.created_at, d.started_at, d.ended_at
    from duel_seats s join duels d on d.id = s.duel_id
    where s.is_bot = 0 and s.player_id in (select value from json_each(?)) and d.kind = 'play'
    order by d.id desc limit ?`).all(playerIds, RECENT) as DuelRow[];
  const drafts = db.prepare(`
    select d.id, d.web_slug, d.name, d.status, d.created_at, d.started_at, d.ended_at
    from draft_players dp join drafts d on d.id = dp.draft_id
    where dp.player_id in (select value from json_each(?)) and d.web_slug is not null
    order by d.id desc limit ?`).all(playerIds, RECENT) as DraftRow[];
  const recent = [...duels.map(duelActivity), ...drafts.map(draftActivity)]
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, RECENT);

  const weekFrom = new Date(now - 7 * DAY_MS).toISOString();
  const monthFrom = new Date(now - 30 * DAY_MS).toISOString();
  const week = db.prepare(`
    select
      (select count(*) from duel_seats s join duels d on d.id = s.duel_id
        where s.is_bot = 0 and s.player_id in (select value from json_each(@ids)) and d.kind = 'play'
          and d.started_at is not null and julianday(d.started_at) >= julianday(@weekFrom)) as duels,
      (select count(*) from draft_players dp join drafts d on d.id = dp.draft_id
        where dp.player_id in (select value from json_each(@ids)) and d.started_at is not null
          and julianday(d.started_at) >= julianday(@weekFrom)) as drafts`).get({ ids: playerIds, weekFrom }) as { duels: number; drafts: number };
  const finished = db.prepare(`
    select d.format, s.seat, d.winner_seat from duel_seats s join duels d on d.id = s.duel_id
    where s.is_bot = 0 and s.player_id in (select value from json_each(?)) and d.kind = 'play' and d.status = 'completed'
      and d.winner_seat is not null and d.ended_at is not null and julianday(d.ended_at) >= julianday(?)`).all(playerIds, monthFrom) as
    { format: string; seat: number; winner_seat: number }[];
  const wins = finished.filter((row) => {
    const format = (row.format in FORMAT_LABEL ? row.format : "1v1") as DuelFormat;
    return teamOfSeat(format, row.seat) === teamOfSeat(format, row.winner_seat);
  }).length;

  const current = online && route ? currentPlace(route, placesOf(db, [userId], guild).get(userId)) : null;
  const label = route ? (route === "/duels/[slug]" && current?.kind === "duel" ? current.label : PRESENCE_ROUTES[route]) : null;
  return {
    userId: user.id, name: user.display_name || user.username, username: user.username, avatarUrl: safeAvatarUrl(user.image_url),
    online, label, lastSeenAt: user.last_seen_at, onlineSince: online ? user.online_since : null,
    joinedAt: user.first_sign_in_at ?? dbTimeMs(user.created_at),
    current, recent, week: { duels: week.duels, drafts: week.drafts }, results: { wins, games: finished.length },
  };
}
