import Database from "better-sqlite3";
import { resolveDraftDatabasePath } from "./draft-access.js";

/** Authenticated guild readers can read tournaments. Visibility policy belongs here. */
export function findTournamentReadAccess(db: Database.Database, slug: string, guildId: string, _userId: number) {
  const tournament = db.prepare("select id, status from tournaments where web_slug = ? and guild_id = ?")
    .get(slug, guildId) as { id: number; status: string } | undefined;
  if (!tournament) return null;
  return { ...tournament, canRead: true };
}

/** Lazy readonly access to the same database mounted by web and ws. */
export function createTournamentAccessReader(databasePath = process.env.DATABASE_PATH ?? "./data/bot.sqlite") {
  const resolvedDatabasePath = resolveDraftDatabasePath(databasePath);
  let db: Database.Database | undefined;
  return {
    canReadTournament(claims: { slug: string; guildId: string; userId: number }): boolean {
      db ??= new Database(resolvedDatabasePath, { readonly: true, fileMustExist: true });
      return findTournamentReadAccess(db, claims.slug, claims.guildId, claims.userId)?.canRead ?? false;
    },
    close() {
      db?.close();
      db = undefined;
    },
  };
}
