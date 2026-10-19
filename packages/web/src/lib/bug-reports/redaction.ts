import type Database from "better-sqlite3";

/** Remove the current guild's Discord identities from player-written public text. */
export function reportRedactions(db: Database.Database, guildId: string): string[] {
  const identities = db.prepare("select discord_user_id, display_name from players where guild_id = ?")
    .all(guildId) as Array<{ discord_user_id: string; display_name: string }>;
  return [guildId, ...identities.flatMap(player => [player.discord_user_id, player.display_name])];
}
