import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createPlayerRepository } from "../../src/repositories/players.js";

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  return { db, players: createPlayerRepository(db) };
}

describe("player repository", () => {
  it("creates a player once per guild and user", () => {
    const { db, players } = setup();

    const first = players.upsert("guild-1", "900000000000000101", "Yugi");
    const second = players.upsert("guild-1", "900000000000000101", "Yugi Moto");

    expect(first.id).toBe(second.id);
    expect(first.userId).toBe(second.userId);
    expect(players.findByDiscordId("guild-1", "900000000000000101")).toEqual(second);
    expect(players.findById(first.id)).toEqual(second);
    expect(second.displayName).toBe("Yugi Moto");
    db.close();
  });
  it("resolves a creator without inventing a player", () => {
    const { db, players } = setup();
    try {
      const first = players.ensureUser("900000000000000102", "Host");
      expect(players.ensureUser("900000000000000102", "Host").id).toBe(first.id);
      expect(db.prepare("select count(*) as count from users").get()).toEqual({ count: 1 });
      expect(db.prepare("select count(*) as count from players").get()).toEqual({ count: 0 });
    } finally { db.close(); }
  });
});
