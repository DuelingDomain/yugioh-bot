import type Database from "better-sqlite3";

/** Synthetic local session identities. Never convert a real Discord ID to a number. */
export function seedIdentity(db: Database.Database, input: {
  guildId?: string; userId?: string | number; playerId?: number; name?: string; discordUserId?: string | null;
} = {}) {
  const guildId = input.guildId ?? "g";
  const userId = String(input.userId ?? "101");
  const name = input.name ?? "Test actor";
  const result = db.prepare("insert into players(id,guild_id,discord_user_id,display_name) values(?,?,?,?)")
    .run(input.playerId ?? null, guildId, userId, name);
  return { userId, playerId: Number(result.lastInsertRowid), discordUserId: userId };
}
