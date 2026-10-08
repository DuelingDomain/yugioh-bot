import type Database from "better-sqlite3";

// test/local-all has no users table yet. This helper keeps the API of the
// main-branch helper, so cherry-picked tests run against the players-only schema.
const users = new WeakMap<Database.Database, Map<string, { userId: number; discordUserId: string }>>();

/** A fixture actor. Without a users table, the user is a stable Discord id per key. */
export function seedUser(db: Database.Database, key: string): { userId: number; discordUserId: string | null } {
  let known = users.get(db);
  if (!known) users.set(db, known = new Map());
  const existing = known.get(key);
  if (existing) return existing;
  const userId = 101 + known.size;
  const created = { userId, discordUserId: /^\d{1,25}$/.test(key) ? key : `900000000000000${userId}` };
  known.set(key, created);
  return created;
}

export function seedIdentity(db: Database.Database, input: {
  guildId?: string; name?: string; discordUserId?: string | null; userId?: number; playerId?: number;
} = {}): { userId: number; playerId: number; discordUserId: string | null } {
  const name = input.name ?? "Test duelist";
  const userId = input.userId ?? 101 + (users.get(db)?.size ?? 0);
  const fromUser = [...(users.get(db)?.values() ?? [])].find((user) => user.userId === input.userId)?.discordUserId;
  const discord = input.discordUserId ?? fromUser ?? `900000000000000${userId}`;
  const playerId = Number(db.prepare("insert into players(id,guild_id,discord_user_id,display_name) values(?,?,?,?)")
    .run(input.playerId ?? null, input.guildId ?? "g", discord, name).lastInsertRowid);
  return { userId, playerId, discordUserId: discord };
}
