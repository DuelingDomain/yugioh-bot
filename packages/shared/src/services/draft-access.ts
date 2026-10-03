import Database from "better-sqlite3";

export const DRAFT_READ_ACCESS_ERROR = "This draft is only open to its players.";

/** Guild membership is checked by the web before issuing a room token. */
export function findDraftReadAccess(db: Database.Database, slug: string, guildId: string, userId: string) {
  const draft = db.prepare(`
    select d.id, d.status, d.created_by_user_id as creatorUserId,
      exists (
        select 1 from draft_players dp
        inner join players p on p.id = dp.player_id
        where dp.draft_id = d.id and p.guild_id = d.guild_id and p.discord_user_id = ?
      ) as isPlayer
    from drafts d where d.web_slug = ? and d.guild_id = ?
  `).get(userId, slug, guildId) as
    | { id: number; status: string; creatorUserId: string; isPlayer: number }
    | undefined;
  if (!draft) return null;
  return {
    id: draft.id,
    status: draft.status,
    canRead: draft.status === "pending" || draft.creatorUserId === userId || Boolean(draft.isPlayer),
  };
}

/** The ws container already mounts this database; only read access is needed. */
export function createDraftAccessReader(databasePath = process.env.DATABASE_PATH ?? "./data/bot.sqlite") {
  let db: Database.Database | undefined;
  return {
    canReadDraft(claims: { slug: string; guildId: string; userId: string }): boolean {
      db ??= new Database(databasePath, { readonly: true, fileMustExist: true });
      return findDraftReadAccess(db, claims.slug, claims.guildId, claims.userId)?.canRead ?? false;
    },
    close() {
      db?.close();
      db = undefined;
    },
  };
}
