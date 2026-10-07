import Database from "better-sqlite3";
import { afterAll, afterEach, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createUserService } from "../../src/services/users.js";
const db = new Database(":memory:"); migrate(db); db.pragma("foreign_keys=on");
afterAll(() => db.close());
const users = createUserService(db);
afterEach(() => { db.exec("delete from players; delete from users"); });
it("keeps one user, normalizes email, clears stale verification and keeps username", () => {
  const a = users.ensureDiscord({ discordUserId: "900000000000000101", displayName: "Yugi", email: " A@EXAMPLE.COM ", emailVerified: true });
  expect(a).toMatchObject({ email: "a@example.com", emailVerified: true, clerkUserId: null, syncedAt: null });
  const b = users.ensureDiscord({ discordUserId: a.discordUserId!, displayName: "Changed", email: "B@example.com", emailVerified: false });
  expect(b).toMatchObject({ id: a.id, username: a.username, email: "b@example.com", emailVerified: false });
  expect(users.ensureDiscord({ discordUserId: a.discordUserId!, displayName: "Bot lookup" }).email).toBe("b@example.com");
  expect(users.ensureDiscord({ discordUserId: a.discordUserId!, displayName: "Yugi", email: null, emailVerified: true })).toMatchObject({ email: null, emailVerified: false });
});
it("does not merge duplicate emails or fabricate a Discord account for local users", () => {
  const a = users.ensureDiscord({ discordUserId: "900000000000000101", displayName: "A", email: "same@example.com", emailVerified: true });
  const b = users.ensureDiscord({ discordUserId: "900000000000000102", displayName: "B", email: "same@example.com", emailVerified: true });
  expect(a.id).not.toBe(b.id);
  const local = users.createNonLogin("!!!");
  expect(local).toMatchObject({ username: `duelist_${local.id}`, discordUserId: null, email: null, emailVerified: false });
  expect(() => users.ensureDiscord({ discordUserId: "clerk:x", displayName: "X" })).toThrow();
});

it("finds application users by ID and Discord ID without treating local users as Discord accounts", () => {
  const user = users.ensureDiscord({ discordUserId: "900000000000000103", displayName: "  Yugi Muto  " });
  expect(Number.isSafeInteger(user.id) && user.id > 0).toBe(true);
  expect(user.username).toBe(`yugi_muto_${user.id}`);
  expect(users.findById(user.id)).toEqual(user);
  expect(users.findByDiscordId(user.discordUserId!)).toEqual(user);
  expect(users.findById(999999)).toBeUndefined();
  expect(users.findByDiscordId("900000000000000999")).toBeUndefined();
  const local = users.createNonLogin("Kaiba");
  expect(users.findById(local.id)).toEqual(local);
  expect(users.findByDiscordId(String(local.id))).toBeUndefined();
});

it("preserves email and verification on lookup and requires fresh verification for replacement", () => {
  const user = users.ensureDiscord({ discordUserId: "900000000000000104", displayName: "A", email: "a@example.com", emailVerified: true });
  expect(users.ensureDiscord({ discordUserId: user.discordUserId!, displayName: "B", emailVerified: false })).toMatchObject({ email: "a@example.com", emailVerified: true });
  expect(users.ensureDiscord({ discordUserId: user.discordUserId!, displayName: "B", email: "a@example.com", emailVerified: false })).toMatchObject({ email: "a@example.com", emailVerified: false });
  expect(users.ensureDiscord({ discordUserId: user.discordUserId!, displayName: "B", email: "b@example.com" })).toMatchObject({ email: "b@example.com", emailVerified: false });
  expect(users.ensureDiscord({ discordUserId: user.discordUserId!, displayName: "B", email: "   ", emailVerified: true })).toMatchObject({ email: null, emailVerified: false });
});

it("synchronizes compatibility IDs across guilds in the same transaction", () => {
  const user = users.ensureDiscord({ discordUserId: "900000000000000105", displayName: "A" });
  db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values(?,?,?,?)").run("g", user.id, null, "A");
  db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values(?,?,?,?)").run("other", user.id, null, "A");
  users.ensureDiscord({ discordUserId: user.discordUserId!, displayName: "B" });
  expect(db.prepare("select discord_user_id from players order by id").all()).toEqual([
    { discord_user_id: user.discordUserId }, { discord_user_id: user.discordUserId },
  ]);
});

it("rolls back profile changes when compatibility synchronization fails", () => {
  const user = users.ensureDiscord({ discordUserId: "900000000000000106", displayName: "A", email: "a@example.com", emailVerified: true });
  const other = users.createNonLogin("Other");
  db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values(?,?,?,?)").run("g", user.id, null, "A");
  db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values(?,?,?,?)").run("g", other.id, user.discordUserId, "Other");
  expect(() => users.ensureDiscord({ discordUserId: user.discordUserId!, displayName: "Changed", email: null })).toThrow(/UNIQUE/);
  expect(users.findById(user.id)).toEqual(user);
  expect(db.prepare("select discord_user_id from players where user_id=?").get(user.id)).toEqual({ discord_user_id: null });
  expect(db.inTransaction).toBe(false);
});

it.each(["", "clerk:x", "bot_player_dev_1", "1e3", "-1", " 123", "12345678901234567890123456"])("rejects invalid Discord account %s without allocating a user", discordUserId => {
  expect(() => users.ensureDiscord({ discordUserId, displayName: "Invalid" })).toThrow(/Invalid Discord/);
  expect(db.prepare("select count(*) as n from users").get()).toEqual({ n: 0 });
});
