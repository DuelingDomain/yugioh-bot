import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "../fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));

describe("POST /api/tournaments", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("user-org")), discordUserId: fixtureDiscordId("user-org"), name: "Organizer" } });
    delete process.env.BOT_ANNOUNCE_URL;
    delete process.env.BOT_ANNOUNCE_SECRET;
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("auto-joins the organizer as the first participant", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tourney-create-"));
    const dbPath = join(tempDir, "t.sqlite");
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "guild-1";

    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("../../../shared/src/db/schema");
    const seedDb = new Database(dbPath);
    migrate(seedDb);
    seedFixtureUsers(seedDb, FIXTURE_KEYS);
    seedDb.close();

    const { POST } = await import("../../app/api/tournaments/route");
    const res = await POST(
      new Request("http://localhost/api/tournaments", {
        method: "POST",
        body: JSON.stringify({ name: "My Tournament", format: "round_robin" }),
      }) as any,
    );
    expect(res.status).toBe(201);

    const verifyDb = new Database(dbPath);
    const participants = verifyDb
      .prepare(
        `select p.discord_user_id from tournament_participants tp
         inner join players p on p.id = tp.player_id`,
      )
      .all() as Array<{ discord_user_id: string }>;
    verifyDb.close();

    expect(participants).toHaveLength(1);
    expect(participants[0].discord_user_id).toBe(fixtureDiscordId("user-org"));
  });
});

const FIXTURE_KEYS = ["user-org"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
