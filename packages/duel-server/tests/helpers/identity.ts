import type Database from "better-sqlite3";

// Local application users are Discord ids stored directly on players.
const users = new WeakMap<Database.Database, Map<string, { userId: string; discordUserId: string }>>();

/** A fixture actor. Without a users table, the user is a stable Discord id per key. */
export function seedUser(db: Database.Database, key: string): { userId: string; discordUserId: string | null } {
  let known = users.get(db);
  if (!known) users.set(db, known = new Map());
  const existing = known.get(key);
  if (existing) return existing;
  const userId = /^\d{1,25}$/.test(key) ? key : `900000000000000${101 + known.size}`;
  const created = { userId, discordUserId: userId };
  known.set(key, created);
  return created;
}

export function seedIdentity(db: Database.Database, input: {
  guildId?: string; name?: string; discordUserId?: string | null; userId?: string; playerId?: number;
} = {}): { userId: string; playerId: number; discordUserId: string | null } {
  const name = input.name ?? "Test duelist";
  const userId = input.userId ?? input.discordUserId ?? seedUser(db, `identity-${users.get(db)?.size ?? 0}`).userId;
  const discord = input.discordUserId ?? userId;
  const playerId = Number(db.prepare("insert into players(id,guild_id,discord_user_id,display_name) values(?,?,?,?)")
    .run(input.playerId ?? null, input.guildId ?? "g", discord, name).lastInsertRowid);
  return { userId, playerId, discordUserId: discord };
}
