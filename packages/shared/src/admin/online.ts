import type Database from "better-sqlite3";
import { ONLINE_WINDOW_MS, PRESENCE_ROUTES, isPresenceRoute, type PresenceRoute } from "../presence/index.js";

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
  userId: number;
  /** Display name, or the username when the display name is empty. */
  name: string;
  username: string;
  /** https profile picture from the last sign-in sync, or null. */
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
  id: number; display_name: string; username: string; image_url: string | null;
  last_seen_at: number; last_route: string | null; online_since: number | null;
};
type PlaceRow = { user_id: number; kind: "duel" | "draft"; slug: string; name: string; status: string; format: string | null };

/** Only https pictures are passed on. Anything else gives the initials circle. */
export function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; }
}

/**
 * The newest open duel table and draft of each person, in two queries. Duels: lobby or active play tables
 * where the person has a seat. Drafts: pending or active drafts the person joined. Scoped to the guild when given.
 */
export function placesOf(db: Database.Database, userIds: number[], guild: string | null): Map<number, { duel?: PlaceRow; draft?: PlaceRow }> {
  const places = new Map<number, { duel?: PlaceRow; draft?: PlaceRow }>();
  if (userIds.length === 0) return places;
  const ids = JSON.stringify(userIds);
  const duels = db.prepare(`
    select p.user_id, 'duel' as kind, d.web_slug as slug, d.name, d.status, d.format from duels d
    join duel_seats s on s.duel_id = d.id join players p on p.id = s.player_id
    where p.user_id in (select value from json_each(@ids)) and d.status in ('lobby','active') and d.kind = 'play'
      and d.archived_at is null and (@guild is null or d.guild_id = @guild)
    order by d.id desc`).all({ ids, guild }) as PlaceRow[];
  const drafts = db.prepare(`
    select p.user_id, 'draft' as kind, d.web_slug as slug, d.name, d.status, null as format from drafts d
    join draft_players dp on dp.draft_id = d.id join players p on p.id = dp.player_id
    where p.user_id in (select value from json_each(@ids)) and d.status in ('pending','active') and d.web_slug is not null
      and (@guild is null or d.guild_id = @guild)
    order by d.id desc`).all({ ids, guild }) as PlaceRow[];
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

/** Pick the place that fits the page the person is on; otherwise a running game before a lobby, a duel before a draft. */
export function currentPlace(route: PresenceRoute, found: { duel?: PlaceRow; draft?: PlaceRow } | undefined): OnlinePlace | null {
  if (!found) return null;
  const { duel, draft } = found;
  if (route.startsWith("/duels/[slug]") && duel) return place(duel);
  if ((route === "/draft/[slug]" || route === "/decks/draft/[slug]") && draft) return place(draft);
  const running = [duel, draft].find((row) => row && row.status === "active");
  const chosen = running ?? duel ?? draft;
  return chosen ? place(chosen) : null;
}

export function listOnline(db: Database.Database, now = Date.now(), guild: string | null = null): OnlineSnapshot {
  const rows = db.prepare(`
    select id, display_name, username, image_url, last_seen_at, last_route, online_since from users
    where last_seen_at >= ? order by last_seen_at desc limit 500`).all(now - ONLINE_WINDOW_MS) as UserRow[];
  const places = placesOf(db, rows.map((row) => row.id), guild);
  const users = rows.map((row): OnlineUser => {
    const route: PresenceRoute = isPresenceRoute(row.last_route) ? row.last_route : "/app";
    const current = currentPlace(route, places.get(row.id));
    // On a duel page the table type says more than "Duel".
    const label = route === "/duels/[slug]" && current?.kind === "duel" ? current.label : PRESENCE_ROUTES[route];
    return {
      userId: row.id, name: row.display_name || row.username, username: row.username, avatarUrl: safeAvatarUrl(row.image_url),
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
    || a.userId - b.userId);
  const groups = new Map<string, number>();
  for (const user of users) groups.set(user.label, (groups.get(user.label) ?? 0) + 1);
  const bySection = [...groups].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { count: users.length, windowSeconds: ONLINE_WINDOW_MS / 1000, users, bySection };
}
