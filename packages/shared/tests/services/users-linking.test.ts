import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createUserService, USER_SYNC_MAX_AGE_MS, type UserService } from "../../src/services/users.js";
import type { ClerkProfile } from "../../src/clerk/profile.js";

let db: Database.Database;
let users: UserService;
const now = new Date("2026-10-06T12:00:00Z");
const discord = "900000000000000101";
const profile: ClerkProfile = { clerkUserId: "user_a", username: "yugi", displayName: "Yugi", email: " YUGI@EXAMPLE.COM ", emailVerified: true, discordUserId: null, imageUrl: null };
beforeEach(() => { db = new Database(":memory:"); migrate(db); db.pragma("foreign_keys=on"); users = createUserService(db); });
afterEach(() => { expect(db.inTransaction).toBe(false); expect(db.pragma("foreign_key_check")).toEqual([]); db.close(); });
function player(userId: number, guild = "g") {
  return Number(db.prepare("insert into players(guild_id,user_id,display_name) values(?,?,'Player')").run(guild, userId).lastInsertRowid);
}
function history(userId: number) {
  db.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g',?,?)").run(`Cube ${userId}`, userId);
}
function players(userId: number) { return db.prepare("select * from players where user_id=? order by id").all(userId); }

it("links an email-first user holding only grants to an imported Discord user with history", () => {
  const b = users.ensureDiscord({ discordUserId: discord, displayName: "Imported" });
  const bPlayerId = player(b.id); history(b.id);
  const a = users.resolveClerkProfile(profile, now).user;
  db.prepare("insert into drafts(id,guild_id,name,status,created_by_user_id) values(1,'g','Private','pending',?)").run(b.id);
  db.prepare("insert into draft_invite_grants(draft_id,user_id) values(1,?)").run(a.id);
  const outcome = users.resolveClerkProfile({ ...profile, discordUserId: discord }, now);
  expect(outcome).toMatchObject({ user: { id: b.id, clerkUserId: "user_a", discordUserId: discord }, conflict: null, foldedUserId: a.id });
  expect(users.findById(a.id)).toBeUndefined();
  expect(players(b.id)).toEqual([expect.objectContaining({ id: bPlayerId, user_id: b.id })]);
  expect(db.prepare("select user_id from draft_invite_grants").get()).toEqual({ user_id: b.id });
});

it("keeps grants when attaching an unclaimed Discord account to an email-first user", () => {
  const a = users.resolveClerkProfile(profile, now).user;
  const host = users.createNonLogin("Host");
  db.prepare("insert into drafts(id,guild_id,name,status,created_by_user_id) values(1,'g','Private','pending',?)").run(host.id);
  db.prepare("insert into draft_invite_grants(draft_id,user_id) values(1,?)").run(a.id);
  expect(users.resolveClerkProfile({ ...profile, discordUserId: discord }, now)).toMatchObject({ user: { id: a.id, discordUserId: discord }, conflict: null, foldedUserId: null });
  expect(db.prepare("select user_id from draft_invite_grants").get()).toEqual({ user_id: a.id });
});

it("creates and re-reads a Clerk user without attaching a duplicate-email identity", () => {
  const other = users.ensureDiscord({ discordUserId: discord, displayName: "Other", email: "yugi@example.com", emailVerified: true });
  const outcome = users.resolveClerkProfile(profile, now);
  expect(outcome).toMatchObject({ conflict: null, foldedUserId: null, user: { clerkUserId: "user_a", username: "yugi", displayName: "Yugi", email: "yugi@example.com", emailVerified: true, discordUserId: null, syncedAt: now.toISOString(), updatedAt: now.toISOString() } });
  expect(outcome.user.id).not.toBe(other.id);
  expect(users.findByClerkId("user_a")).toEqual(outcome.user);
  expect(users.findByClerkId("user_missing")).toBeUndefined();
});
it("clears a missing Discord account across guilds without deleting players or history", () => {
  const a = users.resolveClerkProfile({ ...profile, discordUserId: discord }, now).user;
  const ids = [player(a.id), player(a.id, "other")];
  history(a.id);
  users.resolveClerkProfile({ ...profile, discordUserId: discord }, now);
  const outcome = users.resolveClerkProfile(profile, now);
  expect(outcome.user.discordUserId).toBeNull();
  expect(players(a.id)).toEqual(ids.map(id => expect.objectContaining({ id, user_id: a.id, discord_user_id: null })));
  expect(db.prepare("select created_by_user_id from cubes").get()).toEqual({ created_by_user_id: a.id });
});
it("attaches an unclaimed Discord account to A and all A's players idempotently", () => {
  const a = users.resolveClerkProfile(profile, now).user;
  const ids = [player(a.id), player(a.id, "other")];
  const outcome = users.resolveClerkProfile({ ...profile, discordUserId: discord }, now);
  expect(outcome).toMatchObject({ user: { id: a.id, discordUserId: discord }, conflict: null, foldedUserId: null });
  expect(players(a.id)).toEqual(ids.map(id => expect.objectContaining({ id, user_id: a.id, discord_user_id: discord })));
  expect(users.resolveClerkProfile({ ...profile, discordUserId: discord }, now)).toEqual(outcome);
});
it("refuses an already claimed Discord identity even when A has no history", () => {
  const b = users.resolveClerkProfile({ ...profile, clerkUserId: "user_b", discordUserId: discord }, now).user;
  player(b.id);
  const before = players(b.id);
  const outcome = users.resolveClerkProfile({ ...profile, discordUserId: discord }, now);
  expect(outcome).toMatchObject({ user: { clerkUserId: "user_a", discordUserId: null }, conflict: "discord_claimed", foldedUserId: null });
  expect(users.findById(b.id)).toEqual(b);
  expect(players(b.id)).toEqual(before);
});
it.each([false, true])("preserves imported B when A is empty (B has history=%s)", bHasHistory => {
  const b = users.ensureDiscord({ discordUserId: discord, displayName: "Imported" });
  const bPlayerId = player(b.id);
  if (bHasHistory) db.prepare("insert into player_ratings(guild_id,player_id) values('g',?)").run(bPlayerId);
  const a = users.resolveClerkProfile(profile, now).user;
  player(a.id);
  const outcome = users.resolveClerkProfile({ ...profile, discordUserId: discord }, now);
  expect(outcome).toMatchObject({ user: { id: b.id, clerkUserId: "user_a", displayName: "Yugi", discordUserId: discord, syncedAt: now.toISOString() }, conflict: null, foldedUserId: a.id });
  expect(users.findById(a.id)).toBeUndefined();
  expect(players(a.id)).toEqual([]);
  expect(players(b.id)).toEqual([expect.objectContaining({ id: bPlayerId, user_id: b.id })]);
  expect(users.findByClerkId("user_a")).toEqual(outcome.user);
  if (bHasHistory) expect(db.prepare("select player_id from player_ratings").get()).toEqual({ player_id: bPlayerId });
});
it("folds empty B into history-bearing A without moving A's players", () => {
  const a = users.resolveClerkProfile(profile, now).user;
  const aPlayerId = player(a.id); history(a.id);
  const b = users.ensureDiscord({ discordUserId: discord, displayName: "Imported" });
  player(b.id);
  const outcome = users.resolveClerkProfile({ ...profile, discordUserId: discord }, now);
  expect(outcome).toMatchObject({ user: { id: a.id, discordUserId: discord }, conflict: null, foldedUserId: b.id });
  expect(users.findById(b.id)).toBeUndefined();
  expect(players(b.id)).toEqual([]);
  expect(players(a.id)).toEqual([expect.objectContaining({ id: aPlayerId, user_id: a.id, discord_user_id: discord })]);
});
it("refuses two histories, leaving B and every player untouched while refreshing A's profile", () => {
  const a = users.resolveClerkProfile(profile, now).user;
  player(a.id); history(a.id);
  const b = users.ensureDiscord({ discordUserId: discord, displayName: "Imported" });
  player(b.id); history(b.id);
  const before = db.prepare("select * from players order by id").all();
  const outcome = users.resolveClerkProfile({ ...profile, displayName: "Updated", discordUserId: discord }, now);
  expect(outcome).toMatchObject({ user: { id: a.id, displayName: "Updated", discordUserId: null }, conflict: "both_have_history", foldedUserId: null });
  expect(users.findById(b.id)).toEqual(b);
  expect(db.prepare("select * from players order by id").all()).toEqual(before);
});
it("replaces stale verification and preserves a username when Clerk has none", () => {
  const a = users.resolveClerkProfile(profile, now).user;
  const later = new Date("2026-10-06T12:06:00Z");
  expect(users.resolveClerkProfile({ ...profile, username: null, email: " NEW@EXAMPLE.COM ", emailVerified: false }, later).user)
    .toMatchObject({ id: a.id, username: "yugi", email: "new@example.com", emailVerified: false, syncedAt: later.toISOString() });
  expect(users.resolveClerkProfile({ ...profile, email: null }, later).user).toMatchObject({ email: null, emailVerified: false });
});
it("generates a local fallback username for a new Clerk user without one", () => {
  const user = users.resolveClerkProfile({ ...profile, username: null }, now).user;
  expect(user.username).toBe(`yugi_${user.id}`);
});
it("rolls back the entire profile update when player synchronization fails", () => {
  const a = users.resolveClerkProfile(profile, now).user;
  player(a.id);
  const other = users.createNonLogin("Other");
  const otherPlayer = player(other.id);
  db.prepare("update players set discord_user_id=? where id=?").run(discord, otherPlayer);
  expect(() => users.resolveClerkProfile({ ...profile, displayName: "Changed", discordUserId: discord }, now)).toThrow(/UNIQUE/);
  expect(users.findById(a.id)).toEqual(a);
});

it.each([
  [null, true], ["garbage", true], ["2026-10-06T11:55:01Z", false],
  ["2026-10-06T11:54:59Z", true], ["2026-10-06T11:55:00Z", false],
  ["2026-10-06 11:55:01", false],
])("needsSync handles syncedAt=%s", (syncedAt, expected) => {
  const user = users.createNonLogin("Yugi");
  expect(users.needsSync({ ...user, syncedAt: syncedAt as string | null }, now)).toBe(expected);
});
it("needsSync refreshes a missing user", () => {
  expect(users.needsSync(undefined, now)).toBe(true);
  expect(USER_SYNC_MAX_AGE_MS).toBe(5 * 60_000);
});

it.each(["keep-imported", "keep-clerk"])("combines draft and tournament grants before folding users: %s", branch => {
  const a = users.resolveClerkProfile(profile, now).user;
  const b = users.ensureDiscord({ discordUserId: discord, displayName: "Imported" });
  const keeper = branch === "keep-imported" ? b : a;
  const folded = branch === "keep-imported" ? a : b;
  history(keeper.id);
  for (const [table, column, extra] of [["drafts", "draft_id", ""], ["tournaments", "tournament_id", ",format"]]) {
    for (let id=1;id<=3;id++) db.prepare(`insert into ${table}(id,guild_id,name,status,created_by_user_id${extra}) values(?,'g',?,'pending',?${extra ? ",'round_robin'" : ""})`).run(id, `Entry ${id}`, keeper.id);
    const grantTable = table === "drafts" ? "draft_invite_grants" : "tournament_invite_grants";
    db.prepare(`insert into ${grantTable}(${column},user_id,created_at) values(1,?,'source'),(2,?,'source'),(2,?,'kept'),(3,?,'kept')`).run(folded.id,folded.id,keeper.id,keeper.id);
  }
  expect(users.resolveClerkProfile({ ...profile, discordUserId: discord }, now)).toMatchObject({ user: { id: keeper.id }, foldedUserId: folded.id, conflict: null });
  for (const [table, column] of [["draft_invite_grants", "draft_id"], ["tournament_invite_grants", "tournament_id"]]) {
    expect(db.prepare(`select ${column} as entry,user_id,created_at from ${table} order by ${column}`).all()).toEqual([
      {entry:1,user_id:keeper.id,created_at:"source"},{entry:2,user_id:keeper.id,created_at:"kept"},{entry:3,user_id:keeper.id,created_at:"kept"},
    ]);
  }
});
