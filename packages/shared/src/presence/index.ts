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
 * 30 s for the same route, 10 s when the route changed. A beat after a gap longer than the online window starts a new
 * online stretch. The picture is the https Discord avatar from the session; anything else is not stored.
 */
export function recordPresence(db: Database.Database, discordUserId: string, displayName: string, route: PresenceRoute, now = Date.now(), imageUrl: string | null = null): boolean {
  return db.prepare(`insert into admin_presence(discord_user_id, display_name, last_seen_at, last_route, online_since, image_url)
    values (@id, @name, @now, @route, @now, @image)
    on conflict(discord_user_id) do update set display_name = excluded.display_name,
      online_since = case when admin_presence.last_seen_at < @stretch or admin_presence.online_since is null then excluded.last_seen_at else admin_presence.online_since end,
      last_seen_at = excluded.last_seen_at, last_route = excluded.last_route, image_url = coalesce(excluded.image_url, admin_presence.image_url)
    where admin_presence.last_seen_at <= @sameRoute or (admin_presence.last_seen_at <= @changedRoute and admin_presence.last_route is not excluded.last_route)`)
    .run({ id: discordUserId, name: displayName.slice(0, 80), now, route, image: httpsImage(imageUrl), stretch: now - ONLINE_WINDOW_MS,
      sameRoute: now - HEARTBEAT_RATE_MS, changedRoute: now - ROUTE_CHANGE_RATE_MS }).changes > 0;
}
function httpsImage(value: string | null): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; }
}
export function clearOldPresence(db: Database.Database, now = Date.now()): void {
  db.prepare("delete from admin_presence where last_seen_at <= ?").run(now - PRESENCE_RETENTION_MS);
}
