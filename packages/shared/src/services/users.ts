import type Database from "better-sqlite3";

export interface User {
  id: number;
  clerkUserId: string | null;
  email: string | null;
  emailVerified: boolean;
  username: string;
  displayName: string;
  discordUserId: string | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
}
export interface DiscordUserInput {
  discordUserId: string;
  displayName: string;
  // Omitted = preserve email (bot/JWT lookup); null = clear provider email.
  email?: string | null;
  emailVerified?: boolean;
}
export interface UserService {
  findById(id: number): User | undefined;
  findByDiscordId(discordUserId: string): User | undefined;
  ensureDiscord(input: DiscordUserInput): User;
  createNonLogin(displayName: string): User;
}

type UserRow = {
  id: number; clerk_user_id: string | null; email: string | null; email_verified: number;
  username: string; display_name: string; discord_user_id: string | null;
  created_at: string; updated_at: string; synced_at: string | null;
};
function mapUser(row: UserRow): User {
  return { id: row.id, clerkUserId: row.clerk_user_id, email: row.email,
    emailVerified: row.email_verified === 1, username: row.username, displayName: row.display_name,
    discordUserId: row.discord_user_id, createdAt: row.created_at, updatedAt: row.updated_at, syncedAt: row.synced_at };
}
function usernameFor(name: string, id: number): string {
  const stem = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return stem ? `${stem}_${id}` : `duelist_${id}`;
}
export function createUserService(db: Database.Database): UserService {
  const byId = db.prepare<[number], UserRow>("select * from users where id=?");
  const byDiscord = db.prepare<[string], UserRow>("select * from users where discord_user_id=?");
  const insert = (name: string, discord: string | null): number => {
    const id = Number(db.prepare("insert into users(username,display_name,discord_user_id) values('',?,?)").run(name, discord).lastInsertRowid);
    db.prepare("update users set username=? where id=?").run(usernameFor(name, id), id);
    return id;
  };
  const ensure = db.transaction((input: DiscordUserInput): User => {
    if (!/^[0-9]{1,25}$/.test(input.discordUserId)) throw new Error("Invalid Discord account ID");
    const id = byDiscord.get(input.discordUserId)?.id ?? insert(input.displayName, input.discordUserId);
    db.prepare("update users set display_name=?,updated_at=current_timestamp where id=?").run(input.displayName, id);
    if (Object.prototype.hasOwnProperty.call(input, "email")) {
      const email = input.email?.trim().toLowerCase() || null;
      db.prepare("update users set email=?,email_verified=?,updated_at=current_timestamp where id=?")
        .run(email, email !== null && input.emailVerified === true ? 1 : 0, id);
    }
    db.prepare("update players set discord_user_id=? where user_id=?").run(input.discordUserId, id);
    return mapUser(byId.get(id)!);
  });
  return {
    findById(id) { const row = byId.get(id); return row && mapUser(row); },
    findByDiscordId(discordUserId) { const row = byDiscord.get(discordUserId); return row && mapUser(row); },
    ensureDiscord(input) { return ensure.immediate(input); },
    createNonLogin(displayName) { return db.transaction(() => mapUser(byId.get(insert(displayName, null))!)).immediate(); },
  };
}
