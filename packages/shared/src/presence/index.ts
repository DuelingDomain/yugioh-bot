import type Database from "better-sqlite3";
import type { PresenceRoute } from "./routes.js";
export * from "./routes.js";
export const PRESENCE_RETENTION_MS = 24 * 60 * 60_000;
export const ONLINE_WINDOW_MS = 120_000;
export const HEARTBEAT_RATE_MS = 30_000;
/** A beat with a different route than the stored one is let through after this shorter wait, so the label follows navigation. */
export const ROUTE_CHANGE_RATE_MS = 10_000;

/**
 * Keeps only the latest value per Discord user. Returns false when the last beat is newer than the server-side rate limit:
 * 30 s for the same route, 10 s when the route changed.
 */
export function recordPresence(db: Database.Database, discordUserId: string, displayName: string, route: PresenceRoute, now = Date.now()): boolean {
  return db.prepare(`insert into admin_presence(discord_user_id, display_name, last_seen_at, last_route) values (?, ?, ?, ?)
    on conflict(discord_user_id) do update set display_name = excluded.display_name, last_seen_at = excluded.last_seen_at, last_route = excluded.last_route
    where admin_presence.last_seen_at <= ? or (admin_presence.last_seen_at <= ? and admin_presence.last_route is not excluded.last_route)`)
    .run(discordUserId, displayName.slice(0, 80), now, route, now - HEARTBEAT_RATE_MS, now - ROUTE_CHANGE_RATE_MS).changes > 0;
}
export function clearOldPresence(db: Database.Database, now = Date.now()): void {
  db.prepare("delete from admin_presence where last_seen_at <= ?").run(now - PRESENCE_RETENTION_MS);
}
