import Database from "better-sqlite3";
import type { RemoteConnectionTokenClaims } from "../ws/remote-token.js";
import { createRemoteDuelService } from "./remote-duels.js";
import { resolveDraftDatabasePath } from "./draft-access.js";

/** Recheck exact persisted user/seat identity. No spectators, seat overrides or stale grants. */
export function canReadRemote(db: Database.Database, claims: RemoteConnectionTokenClaims): boolean {
  try {
    return !!db.prepare(`select 1 from remote_tables t join remote_seats s on s.table_id=t.id join users u on u.id=s.user_id
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
    snapshot: (slug: string, guildId: string) => createRemoteDuelService(connection()).snapshot(slug, guildId),
    sweepIdle: (now?: number) => createRemoteDuelService(connection()).sweepIdle(now),
    close() { db?.close(); db = undefined; },
  };
}
