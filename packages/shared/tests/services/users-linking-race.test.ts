import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "../../src/db/connection.js";
import { createUserService, type LinkOutcome } from "../../src/services/users.js";

it("resolves two scheduled connections and a later request to the imported history-bearing user", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clerk-linking-race-"));
  const db1 = openDatabase(join(dir, "test.sqlite"));
  const db2 = openDatabase(join(dir, "test.sqlite"));
  try {
    expect(db1.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db2.pragma("busy_timeout", { simple: true })).toBe(5000);
    const first = createUserService(db1), second = createUserService(db2);
    const imported = first.ensureDiscord({ discordUserId: "900000000000000101", displayName: "Imported" });
    const playerId = Number(db1.prepare("insert into players(guild_id,user_id,display_name) values('g',?,'Imported')").run(imported.id).lastInsertRowid);
    db1.prepare("insert into player_ratings(guild_id,player_id) values('g',?)").run(playerId);
    const profile = { clerkUserId: "user_new", username: "yugi", displayName: "Yugi", email: null, emailVerified: false, discordUserId: imported.discordUserId, imageUrl: null };
    const scheduled = (resolve: () => LinkOutcome) => new Promise<LinkOutcome>((accept, reject) => setImmediate(() => {
      try { accept(resolve()); } catch (error) { reject(error); }
    }));
    const outcomes = await Promise.all([
      scheduled(() => first.resolveClerkProfile(profile)), scheduled(() => second.resolveClerkProfile(profile)),
    ]);
    expect(outcomes.map(result => result.user.id)).toEqual([imported.id, imported.id]);
    expect(outcomes.map(result => result.conflict)).toEqual([null, null]);
    expect(second.resolveClerkProfile(profile)).toMatchObject({ user: { id: imported.id }, conflict: null, foldedUserId: null });
    expect(db1.prepare("select id from users where clerk_user_id='user_new'").all()).toEqual([{ id: imported.id }]);
    expect(db1.prepare("select count(*) as n from users").get()).toEqual({ n: 1 });
    expect(db1.prepare("select id,user_id from players").all()).toEqual([{ id: playerId, user_id: imported.id }]);
    expect(db1.prepare("select player_id from player_ratings").all()).toEqual([{ player_id: playerId }]);
    expect(db1.pragma("foreign_key_check")).toEqual([]);
  } finally { db2.close(); db1.close(); rmSync(dir, { recursive: true, force: true }); }
});
