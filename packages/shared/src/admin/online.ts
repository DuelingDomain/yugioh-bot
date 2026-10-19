import type Database from "better-sqlite3";
import { ONLINE_WINDOW_MS, PRESENCE_ROUTES, isPresenceRoute } from "../presence/index.js";

export interface OnlineUser {
  userId: number;
  name: string;
  /** Friendly section label, for example "Deck builder" or "4-way duel". */
  label: string;
  lastSeenAt: number;
}
export interface OnlineSnapshot {
  count: number;
  windowSeconds: number;
  users: OnlineUser[];
  /** Largest group first. */
  bySection: { label: string; count: number }[];
}

const FORMAT_LABEL: Record<string, string> = { "1v1": "1v1 duel", tag: "Tag duel", ffa3: "3-way duel", ffa4: "4-way duel" };

/**
 * The route templates carry no table type, so a person on /duels/[slug] is matched to their newest
 * lobby or active table to say "4-way duel" or "Duel lobby". No match keeps the plain route label.
 */
function duelLabel(db: Database.Database, userId: number): string | null {
  const row = db.prepare(`
    select d.status, d.format from duels d
    join duel_seats s on s.duel_id = d.id join players p on p.id = s.player_id
    where p.user_id = ? and d.status in ('lobby','active') and d.kind = 'play'
    order by d.id desc limit 1`).get(userId) as { status: string; format: string } | undefined;
  if (!row) return null;
  return row.status === "lobby" ? "Duel lobby" : (FORMAT_LABEL[row.format] ?? "Duel");
}

export function listOnline(db: Database.Database, now = Date.now()): OnlineSnapshot {
  const rows = db.prepare(`
    select id, display_name, username, last_seen_at, last_route from users
    where last_seen_at >= ? order by last_seen_at desc limit 500`).all(now - ONLINE_WINDOW_MS) as
    { id: number; display_name: string; username: string; last_seen_at: number; last_route: string | null }[];
  const users: OnlineUser[] = rows.map((row) => {
    const route = isPresenceRoute(row.last_route) ? row.last_route : "/app";
    const label = route === "/duels/[slug]" ? (duelLabel(db, row.id) ?? PRESENCE_ROUTES[route]) : PRESENCE_ROUTES[route];
    return { userId: row.id, name: row.display_name || row.username, label, lastSeenAt: row.last_seen_at };
  });
  const groups = new Map<string, number>();
  for (const user of users) groups.set(user.label, (groups.get(user.label) ?? 0) + 1);
  const bySection = [...groups].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { count: users.length, windowSeconds: ONLINE_WINDOW_MS / 1000, users, bySection };
}
