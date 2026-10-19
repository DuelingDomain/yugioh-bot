import type Database from "better-sqlite3";
import type { PresenceRoute } from "./routes.js";
export * from "./routes.js";
export const PRESENCE_RETENTION_MS = 24 * 60 * 60_000;
export const ONLINE_WINDOW_MS = 120_000;
export const HEARTBEAT_RATE_MS = 30_000;

/** Keeps only the latest value. Returns false when the last beat is newer than the server-side rate limit. */
export function recordPresence(db: Database.Database, userId: number, route: PresenceRoute, now = Date.now()): boolean {
  return db.prepare(`update users set last_seen_at=?,last_route=? where id=?
    and (last_seen_at is null or last_seen_at<=?)`).run(now, route, userId, now - HEARTBEAT_RATE_MS).changes > 0;
}
export function clearOldPresence(db: Database.Database, now = Date.now()): void {
  db.prepare("update users set last_seen_at=null,last_route=null where last_seen_at<=?").run(now - PRESENCE_RETENTION_MS);
}
