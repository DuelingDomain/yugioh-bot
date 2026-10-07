import type Database from "better-sqlite3";

export type PlayerIdentity = { id: number; userId: number; discordUserId: string | null; displayName: string };

export function playerIdentity(db: Database.Database, playerId: number): PlayerIdentity | null {
  const row = db.prepare(`select p.id, p.user_id, u.discord_user_id, p.display_name
    from players p join users u on u.id = p.user_id where p.id = ?`).get(playerId) as
    { id: number; user_id: number; discord_user_id: string | null; display_name: string } | undefined;
  return row ? { id: row.id, userId: row.user_id, discordUserId: row.discord_user_id, displayName: row.display_name } : null;
}
