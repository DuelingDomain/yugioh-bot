import type Database from "better-sqlite3";

/** Current guild identities removed from public issues and member duplicate suggestions. */
export function reportRedactions(db: Database.Database, guildId: string): string[] {
  const identities = db.prepare(`select u.id, u.username, u.display_name, u.email, u.discord_user_id, p.display_name as player_name
    from players p join users u on u.id = p.user_id where p.guild_id = ?`).all(guildId) as Array<{
      id: number; username: string; display_name: string; email: string | null; discord_user_id: string | null; player_name: string;
    }>;
  return [guildId, ...identities.flatMap(user => [String(user.id), user.username, user.display_name,
    user.email, user.discord_user_id, user.player_name])].filter((value): value is string => typeof value === "string");
}
