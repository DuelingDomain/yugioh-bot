import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "../fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const auth = vi.fn();
const tempDirs: string[] = [];
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("../fixtures/session");
  return sessionFixture(auth);
});

describe("GET /api/dashboard stats", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u1")), discordUserId: fixtureDiscordId("u1"), name: "Yugi" } });
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("counts approved matches as wins/losses", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dash-"));
    const dbPath = join(tempDir, "t.sqlite");
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "g1";

    const { migrate } = await import("../../../shared/src/db/schema");
    const db = new Database(dbPath);
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);
    db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ${fixtureUserId("u1")}, '${fixtureDiscordId("u1")}', 'Yugi')`).run();
    db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ${fixtureUserId("u2")}, '${fixtureDiscordId("u2")}', 'Kaiba')`).run();
    const p1 = (db.prepare(`select id from players where user_id = ${fixtureUserId("u1")}`).get() as any).id;
    const p2 = (db.prepare(`select id from players where user_id = ${fixtureUserId("u2")}`).get() as any).id;
    db.prepare(
      "insert into matches (guild_id, player_one_id, player_two_id, winner_id, reporter_id, status, source) values ('g1', ?, ?, ?, ?, 'approved', 'casual')",
    ).run(p1, p2, p1, p1);
    db.prepare(
      "insert into matches (guild_id, player_one_id, player_two_id, winner_id, reporter_id, status, source) values ('g1', ?, ?, ?, ?, 'approved', 'casual')",
    ).run(p1, p2, p2, p2);
    db.close();

    const { GET } = await import("../../app/api/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats).toEqual({ wins: 1, losses: 1 });
  });
});

const FIXTURE_KEYS = ["u1", "u2"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
