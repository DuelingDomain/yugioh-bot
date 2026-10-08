import type Database from "better-sqlite3";
import type { ClerkProfile } from "../clerk/profile.js";
import { hasHistory } from "./user-history.js";

export const USER_SYNC_MAX_AGE_MS = 5 * 60_000;
export type LinkConflict = "discord_claimed" | "both_have_history";
export interface LinkOutcome { user: User; conflict: LinkConflict | null; foldedUserId: number | null }

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
  /** Claim a server-proven Discord identity without allocating or merging a user. */
  claimExistingDiscordUser(id: number, discordUserId: string, clerkUserId: string): boolean;
  ensureDiscord(input: DiscordUserInput): User;
  createNonLogin(displayName: string): User;
  findByClerkId(clerkUserId: string): User | undefined;
  needsSync(user: User | undefined, now?: Date): boolean;
  resolveClerkProfile(profile: ClerkProfile, now?: Date): LinkOutcome;
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
  const byClerk = db.prepare<[string], UserRow>("select * from users where clerk_user_id=?");
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
  const moveInviteGrants = (sourceId: number, targetId: number) => {
    for (const [table, column] of [["draft_invite_grants", "draft_id"], ["tournament_invite_grants", "tournament_id"]]) {
      db.prepare(`insert or ignore into ${table}(${column},user_id,created_at)
        select ${column},?,created_at from ${table} where user_id=?`).run(targetId, sourceId);
    }
  };
  const resolve = db.transaction((profile: ClerkProfile, now: Date): LinkOutcome => {
    // Identity/history reads must all happen after BEGIN IMMEDIATE acquires the
    // writer lock. No caller's cached user is used to make a folding decision.
    let a = byClerk.get(profile.clerkUserId);
    if (!a) {
      db.prepare("insert into users(clerk_user_id,username,display_name) values(?,'',?) on conflict(clerk_user_id) do nothing")
        .run(profile.clerkUserId, profile.displayName);
      a = byClerk.get(profile.clerkUserId)!;
      db.prepare("update users set username=? where id=?").run(usernameFor(profile.displayName, a.id), a.id);
    }
    const timestamp = now.toISOString();
    const applyProfile = (id: number) => {
      const email = profile.email?.trim().toLowerCase() || null;
      db.prepare("update users set username=coalesce(?,username),display_name=?,email=?,email_verified=?,synced_at=?,updated_at=? where id=?")
        .run(profile.username, profile.displayName, email, email !== null && profile.emailVerified ? 1 : 0, timestamp, timestamp, id);
    };
    const attach = (id: number, discordId: string | null) => {
      db.prepare("update users set discord_user_id=? where id=?").run(discordId, id);
      db.prepare("update players set discord_user_id=? where user_id=?").run(discordId, id);
    };
    const outcome = (id: number, conflict: LinkConflict | null = null, foldedUserId: number | null = null): LinkOutcome =>
      ({ user: mapUser(byId.get(id)!), conflict, foldedUserId });
    applyProfile(a.id);
    const discordId = profile.discordUserId;
    if (discordId === null) {
      attach(a.id, null);
      return outcome(a.id);
    }
    const b = byDiscord.get(discordId);
    if (!b || b.id === a.id) {
      attach(a.id, discordId);
      return outcome(a.id);
    }
    if (b.clerk_user_id !== null) return outcome(a.id, "discord_claimed");
    if (!hasHistory(db, a.id)) {
      moveInviteGrants(a.id, b.id);
      db.prepare("delete from players where user_id=?").run(a.id);
      db.prepare("update users set clerk_user_id=null where id=?").run(a.id);
      db.prepare("delete from users where id=?").run(a.id);
      db.prepare("update users set clerk_user_id=? where id=?").run(profile.clerkUserId, b.id);
      applyProfile(b.id);
      return outcome(b.id, null, a.id);
    }
    if (!hasHistory(db, b.id)) {
      moveInviteGrants(b.id, a.id);
      db.prepare("delete from players where user_id=?").run(b.id);
      db.prepare("update users set discord_user_id=null where id=?").run(b.id);
      db.prepare("delete from users where id=?").run(b.id);
      attach(a.id, discordId);
      return outcome(a.id, null, b.id);
    }
    return outcome(a.id, "both_have_history");
  });
  return {
    findById(id) { const row = byId.get(id); return row && mapUser(row); },
    findByDiscordId(discordUserId) { const row = byDiscord.get(discordUserId); return row && mapUser(row); },
    claimExistingDiscordUser(id, discordUserId, clerkUserId) {
      return db.transaction(() => db.prepare("update users set clerk_user_id=?,updated_at=current_timestamp where id=? and discord_user_id=? and clerk_user_id is null")
        .run(clerkUserId, id, discordUserId).changes === 1).immediate();
    },
    ensureDiscord(input) { return ensure.immediate(input); },
    createNonLogin(displayName) { return db.transaction(() => mapUser(byId.get(insert(displayName, null))!)).immediate(); },
    findByClerkId(clerkUserId) { const row = byClerk.get(clerkUserId); return row && mapUser(row); },
    needsSync(user, now = new Date()) {
      if (!user?.syncedAt) return true;
      // SQLite CURRENT_TIMESTAMP is UTC but has no timezone suffix.
      const value = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(user.syncedAt) ? `${user.syncedAt.replace(" ", "T")}Z` : user.syncedAt;
      const syncedAt = Date.parse(value);
      return !Number.isFinite(syncedAt) || now.getTime() - syncedAt > USER_SYNC_MAX_AGE_MS;
    },
    resolveClerkProfile(profile, now = new Date()) { return resolve.immediate(profile, now); },
  };
}
