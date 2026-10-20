import type Database from "better-sqlite3";
import type { PresenceRoute } from "./routes.js";
export * from "./routes.js";
export const PRESENCE_RETENTION_MS = 24 * 60 * 60_000;
export const ONLINE_WINDOW_MS = 120_000;
export const HEARTBEAT_RATE_MS = 30_000;
/** A beat with a different route than the stored one is let through after this shorter wait, so the label follows navigation. */
export const ROUTE_CHANGE_RATE_MS = 10_000;

/**
 * Keeps only the latest value. Returns false when the last beat is newer than the server-side rate limit:
 * 30 s for the same route, 10 s when the route changed.
 */
export function recordPresence(db: Database.Database, userId: number, route: PresenceRoute, now = Date.now()): boolean {
  // A beat after a gap longer than the online window starts a new online stretch.
  return db.prepare(`update users set
      online_since=case when last_seen_at is null or last_seen_at<@stretch or online_since is null then @now else online_since end,
      last_seen_at=@now,last_route=@route
    where id=@userId
    and (last_seen_at is null or last_seen_at<=@sameRoute or (last_seen_at<=@changedRoute and last_route is not @route))`)
    .run({ now, route, userId, stretch: now - ONLINE_WINDOW_MS, sameRoute: now - HEARTBEAT_RATE_MS, changedRoute: now - ROUTE_CHANGE_RATE_MS }).changes > 0;
}
/** Pages where the person sits at a table. Leaving one of them must end "in a duel" / "drafting" at once. */
export const TABLE_PRESENCE_ROUTES = ["/duels/[slug]", "/draft/[slug]", "/decks/draft/[slug]"] as const satisfies readonly PresenceRoute[];

/**
 * The browser closed or left a table page (pagehide). Swaps that route for "/app" so the console stops showing the
 * person at a table; the person stays online until the window ends. Only the same route is cleared, so closing a
 * second tab on another page does not move a person who still sits at a table. No rate limit is needed: a repeat
 * finds no matching row and writes nothing, and a new table route needs a normal beat first.
 */
export function leavePresence(db: Database.Database, userId: number, route: PresenceRoute): boolean {
  if (!(TABLE_PRESENCE_ROUTES as readonly string[]).includes(route)) return false;
  return db.prepare("update users set last_route='/app' where id=? and last_route=?").run(userId, route).changes > 0;
}
export function clearOldPresence(db: Database.Database, now = Date.now()): void {
  db.prepare("update users set last_seen_at=null,last_route=null,online_since=null where last_seen_at<=?").run(now - PRESENCE_RETENTION_MS);
}
