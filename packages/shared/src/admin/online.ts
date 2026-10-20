import type Database from "better-sqlite3";
import { DUEL_WAITING_IDLE_TIMEOUT_MS } from "../duels/index.js";
import { ONLINE_WINDOW_MS, PRESENCE_ROUTES, isPresenceRoute, type PresenceRoute } from "../presence/index.js";
import { DUEL_LIVE_IDLE_AFTER_MS } from "../services/duels.js";
import { safeAvatarUrl } from "./avatar.js";

export { safeAvatarUrl } from "./avatar.js";
/** A draft that waits for its first pick this long is treated as abandoned. */
export const PENDING_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The duel table or draft a person is in now. */
export interface OnlinePlace {
  kind: "duel" | "draft";
  /** duels.web_slug or drafts.web_slug. */
  slug: string;
  name: string;
  /** Page to open it, for example /duels/<slug> or /draft/<slug>. */
  href: string;
  /** "4-way duel", "Duel lobby", "Draft", "Draft lobby". */
  label: string;
  status: string;
}
export interface OnlineUser {
  /** Discord ID: this local build has no users table. */
  userId: string;
  name: string;
  /** No usernames on this build (Discord sign-in only). */
  username: null;
  /** https Discord profile picture from the session, or null. */
  avatarUrl: string | null;
  /** Friendly section label, for example "Deck builder" or "4-way duel". */
  label: string;
  route: PresenceRoute;
  lastSeenAt: number;
  /** Start of the current online stretch. Null for a row written before the column existed. */
  onlineSince: number | null;
  current: OnlinePlace | null;
}
export interface OnlineSnapshot {
  count: number;
  windowSeconds: number;
  users: OnlineUser[];
  /** Largest group first. */
  bySection: { label: string; count: number }[];
}

export const FORMAT_LABEL: Record<string, string> = { "1v1": "1v1 duel", tag: "Tag duel", ffa3: "3-way duel", ffa4: "4-way duel" };

type UserRow = {
  discord_user_id: string; display_name: string; image_url: string | null;
  last_seen_at: number; last_route: string | null; online_since: number | null;
};
type PlaceRow = { user_id: string; kind: "duel" | "draft"; slug: string; name: string; status: string; format: string | null };

/**
 * The newest open duel table and draft of each person. It starts from the open tables, with the same cut-offs as
 * the Live view (an active duel idle past DUEL_LIVE_IDLE_AFTER_MS, a lobby past DUEL_WAITING_IDLE_TIMEOUT_MS, a pending
 * draft older than PENDING_DRAFT_MAX_AGE_MS are not open), then joins the seats of the given people.
 * Index: duels_guild_status_idx and drafts_guild_status_created_idx. Scoped to the guild when given.
 */
export function placesOf(db: Database.Database, userIds: string[], guild: string | null, now = Date.now()): Map<string, { duel?: PlaceRow; draft?: PlaceRow }> {
  const places = new Map<string, { duel?: PlaceRow; draft?: PlaceRow }>();
  if (userIds.length === 0) return places;
  const params = {
    ids: JSON.stringify(userIds), guild,
    activeAfter: new Date(now - DUEL_LIVE_IDLE_AFTER_MS).toISOString(),
    waitingAfter: new Date(now - DUEL_WAITING_IDLE_TIMEOUT_MS).toISOString(),
    pendingAfter: new Date(now - PENDING_DRAFT_MAX_AGE_MS).toISOString(),
  };
  const duels = db.prepare(`
    with open as (
      select d.id, d.web_slug, d.name, d.status, d.format from duels d
      where (@guild is null or d.guild_id = @guild) and d.status in ('lobby','active') and d.kind = 'play' and d.archived_at is null
        and julianday(coalesce(d.last_activity_at, d.started_at, d.created_at))
          >= julianday(case when d.status = 'active' then @activeAfter else @waitingAfter end))
    select p.discord_user_id as user_id, 'duel' as kind, o.web_slug as slug, o.name, o.status, o.format
    from open o join duel_seats s on s.duel_id = o.id join players p on p.id = s.player_id
    where p.discord_user_id in (select value from json_each(@ids))
    order by o.id desc`).all(params) as PlaceRow[];
  const drafts = db.prepare(`
    with open as (
      select d.id, d.web_slug, d.name, d.status from drafts d
      where (@guild is null or d.guild_id = @guild) and d.web_slug is not null
        and (d.status = 'active' or (d.status = 'pending' and julianday(d.created_at) >= julianday(@pendingAfter))))
    select p.discord_user_id as user_id, 'draft' as kind, o.web_slug as slug, o.name, o.status, null as format
    from open o join draft_players dp on dp.draft_id = o.id join players p on p.id = dp.player_id
    where p.discord_user_id in (select value from json_each(@ids))
    order by o.id desc`).all(params) as PlaceRow[];
  for (const row of [...duels, ...drafts]) {
    const entry = places.get(row.user_id) ?? {};
    // Rows come newest first, so keep the first one of each kind.
    if (row.kind === "duel") entry.duel ??= row; else entry.draft ??= row;
    places.set(row.user_id, entry);
  }
  return places;
}

function place(row: PlaceRow): OnlinePlace {
  if (row.kind === "duel") {
    return { kind: "duel", slug: row.slug, name: row.name, href: `/duels/${row.slug}`, status: row.status,
      label: row.status === "lobby" ? "Duel lobby" : (FORMAT_LABEL[row.format ?? ""] ?? "Duel") };
  }
  return { kind: "draft", slug: row.slug, name: row.name, href: `/draft/${row.slug}`, status: row.status, label: row.status === "pending" ? "Draft lobby" : "Draft" };
}

/**
 * The table that fits the page the person is on: their open duel on a duel page, their open draft on a draft page.
 * On any other page the person is not at a table now, so null.
 */
export function currentPlace(route: PresenceRoute, found: { duel?: PlaceRow; draft?: PlaceRow } | undefined): OnlinePlace | null {
  if (!found) return null;
  if (route === "/duels/[slug]") return found.duel ? place(found.duel) : null;
  if (route === "/draft/[slug]" || route === "/decks/draft/[slug]") return found.draft ? place(found.draft) : null;
  return null;
}

export function listOnline(db: Database.Database, now = Date.now(), guild: string | null = null): OnlineSnapshot {
  const rows = db.prepare(`
    select discord_user_id, display_name, image_url, last_seen_at, last_route, online_since from admin_presence
    where last_seen_at >= ? order by last_seen_at desc limit 500`).all(now - ONLINE_WINDOW_MS) as UserRow[];
  const places = placesOf(db, rows.map((row) => row.discord_user_id), guild, now);
  const users = rows.map((row): OnlineUser => {
    const route: PresenceRoute = isPresenceRoute(row.last_route) ? row.last_route : "/app";
    const current = currentPlace(route, places.get(row.discord_user_id));
    // On a duel page the table type says more than "Duel".
    const label = route === "/duels/[slug]" && current?.kind === "duel" ? current.label : PRESENCE_ROUTES[route];
    return {
      userId: row.discord_user_id, name: row.display_name || "Player", username: null, avatarUrl: safeAvatarUrl(row.image_url),
      label, route, lastSeenAt: row.last_seen_at, onlineSince: row.online_since, current,
    };
  });
  // A stable order that does not jump on each poll: people in duels, then drafts, then the rest.
  // People at one table stay together (bigger tables first); in a group, who came online first leads.
  const kindRank = (user: OnlineUser) => (user.current?.kind === "duel" ? 0 : user.current?.kind === "draft" ? 1 : 2);
  const tableKey = (user: OnlineUser) => (user.current ? `${user.current.kind}:${user.current.slug}` : "");
  const tableSize = new Map<string, number>();
  for (const user of users) tableSize.set(tableKey(user), (tableSize.get(tableKey(user)) ?? 0) + 1);
  users.sort((a, b) => kindRank(a) - kindRank(b)
    || (tableSize.get(tableKey(b)) ?? 0) - (tableSize.get(tableKey(a)) ?? 0)
    || tableKey(a).localeCompare(tableKey(b))
    || (a.onlineSince ?? a.lastSeenAt) - (b.onlineSince ?? b.lastSeenAt)
    || a.userId.localeCompare(b.userId));
  const groups = new Map<string, number>();
  for (const user of users) groups.set(user.label, (groups.get(user.label) ?? 0) + 1);
  const bySection = [...groups].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { count: users.length, windowSeconds: ONLINE_WINDOW_MS / 1000, users, bySection };
}
