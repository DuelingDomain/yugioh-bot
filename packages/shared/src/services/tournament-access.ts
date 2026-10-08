import Database from "better-sqlite3";
import { resolveDraftDatabasePath } from "./draft-access.js";

export const TOURNAMENT_READ_ACCESS_ERROR = "Tournament not found";

/** Detail, admission and sockets share application-user permissions by slug or id. */
export function findTournamentReadAccess(db: Database.Database, ref: string | number, guildId: string, userId: number) {
  const tournament = db.prepare(`
    select t.id, t.status, t.visibility, t.created_by_user_id as creatorUserId,
      exists (
        select 1 from tournament_participants tp
        inner join players p on p.id = tp.player_id
        where tp.tournament_id = t.id and p.guild_id = t.guild_id and p.user_id = ?
      ) as isParticipant,
      exists (select 1 from tournament_invite_grants g where g.tournament_id = t.id and g.user_id = ?) as hasGrant
    from tournaments t where t.${typeof ref === "number" ? "id" : "web_slug"} = ? and t.guild_id = ?
  `).get(userId, userId, ref, guildId) as
    | { id: number; status: string; visibility: "open" | "private"; creatorUserId: number; isParticipant: number; hasGrant: number }
    | undefined;
  if (!tournament) return null;
  const eligible = tournament.visibility === "open" || tournament.creatorUserId === userId || Boolean(tournament.hasGrant);
  return {
    id: tournament.id,
    status: tournament.status,
    visibility: tournament.visibility,
    isParticipant: Boolean(tournament.isParticipant),
    canRead: eligible || Boolean(tournament.isParticipant),
    canJoin: tournament.status === "pending" && !tournament.isParticipant && eligible,
  };
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
