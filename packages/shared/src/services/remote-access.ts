import Database from "better-sqlite3";
import type { RemoteConnectionTokenClaims } from "../ws/remote-token.js";
import { isRemoteDuelUser } from "../access/remote-duel-users.js";
import { createRemoteDuelService, REMOTE_SPECTATOR_SLOT_MS } from "./remote-duels.js";
import { resolveDraftDatabasePath } from "./draft-access.js";

/** Recheck the rollout list and exact persisted user/seat identity. No seat overrides or stale grants. A spectator needs a public table and a live slot. */
export function canReadRemote(db: Database.Database, claims: RemoteConnectionTokenClaims, now = Date.now()): boolean {
  try {
    if (claims.seat === null) return isRemoteDuelUser(claims.userId) && !!db.prepare(`select 1 from remote_tables t join remote_spectators v on v.table_id=t.id join users u on u.id=v.user_id
      where t.slug=? and t.guild_id=? and t.visibility='public' and t.solo=0 and v.user_id=? and v.last_seen_at>?
      and not exists (select 1 from remote_seats s where s.table_id=t.id and s.user_id=v.user_id)`)
      .get(claims.slug, claims.guildId, claims.userId, now - REMOTE_SPECTATOR_SLOT_MS);
    return isRemoteDuelUser(claims.userId) && !!db.prepare(`select 1 from remote_tables t join remote_seats s on s.table_id=t.id join users u on u.id=s.user_id
      where t.slug=? and t.guild_id=? and s.user_id=? and s.seat=?`)
      .get(claims.slug, claims.guildId, claims.userId, claims.seat);
  } catch { return false; }
}
/** Lazy connection: ws never creates or migrates the DB. Write access is needed only by the idle sweep. */
export function createRemoteAccessReader(databasePath = process.env.DATABASE_PATH ?? "./data/bot.sqlite") {
  let db: Database.Database | undefined;
  const path = resolveDraftDatabasePath(databasePath);
  function connection() {
    db ??= new Database(path, { fileMustExist: true, timeout: 5000 });
    db.pragma("foreign_keys=on"); return db;
  }
  return {
    canRead: (claims: RemoteConnectionTokenClaims) => { try { return canReadRemote(connection(), claims); } catch { return false; } },
    snapshot: (slug: string, guildId: string, userId?: number) => createRemoteDuelService(connection()).snapshot(slug, guildId, userId),
    spectatorSnapshot: (slug: string, guildId: string) => createRemoteDuelService(connection()).spectatorSnapshot(slug, guildId),
    sweepIdle: (now?: number) => createRemoteDuelService(connection()).sweepIdle(now),
    close() { db?.close(); db = undefined; },
  };
}
