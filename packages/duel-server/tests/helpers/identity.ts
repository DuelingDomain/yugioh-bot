import type Database from "better-sqlite3";

/** A fixture actor may own resources without having a gameplay player. */
export function seedUser(db: Database.Database, key: string): { userId: number; discordUserId: string | null } {
  return db.transaction(() => {
    const username = `fixture:${key}`;
    const known = db.prepare("select id, discord_user_id from users where username = ?").get(username) as
      { id: number; discord_user_id: string | null } | undefined;
    if (known) return { userId: known.id, discordUserId: known.discord_user_id };
    const { id } = db.prepare("select coalesce(max(id), 100) + 1 as id from users").get() as { id: number };
    const isBot = /^(bot_player_dev_[1-9][0-9]*|tournament_bot_dev_[1-3]|fake_(yugi|kaiba|joey|pegasus))$/.test(key);
    const discordUserId = isBot ? null : /^\d{1,25}$/.test(key) ? key : `900000000000000${id}`;
    db.prepare("insert into users(id, username, display_name, discord_user_id) values(?, ?, ?, ?)")
      .run(id, username, key, discordUserId);
    return { userId: id, discordUserId };
  }).immediate();
}

export function seedIdentity(db: Database.Database, input: {
  guildId?: string; name?: string; discordUserId?: string | null; userId?: number; playerId?: number;
} = {}): { userId: number; playerId: number; discordUserId: string | null } {
  const name = input.name ?? "Test duelist";
  const discord = input.discordUserId ?? null;
  return db.transaction(() => {
    const known = input.userId !== undefined
      ? db.prepare("select id from users where id = ?").get(input.userId) as { id: number } | undefined
      : discord === null ? undefined
      : db.prepare("select id from users where discord_user_id = ?").get(discord) as { id: number } | undefined;
    const userId = known?.id ?? Number(db.prepare("insert into users(id,username,display_name,discord_user_id) values(?,?,?,?)")
      .run(input.userId ?? null, "test_duelist", name, discord).lastInsertRowid);
    const playerId = Number(db.prepare("insert into players(id,guild_id,user_id,discord_user_id,display_name) values(?,?,?,?,?)")
      .run(input.playerId ?? null, input.guildId ?? "g", userId, discord, name).lastInsertRowid);
    return { userId, playerId, discordUserId: discord };
  }).immediate();
}
