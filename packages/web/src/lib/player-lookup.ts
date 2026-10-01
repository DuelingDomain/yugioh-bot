import type Database from "better-sqlite3";

export type PlayerIdentity = { id: number; discordUserId: string; displayName: string };

export function playerIdentity(db: Database.Database, playerId: number): PlayerIdentity | null {
  const row = db
    .prepare("select id, discord_user_id, display_name from players where id = ?")
    .get(playerId) as { id: number; discord_user_id: string; display_name: string } | undefined;
  return row ? { id: row.id, discordUserId: row.discord_user_id, displayName: row.display_name } : null;
}
