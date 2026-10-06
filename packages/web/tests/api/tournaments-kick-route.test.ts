import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "../fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));

async function seedTournamentWithParticipants(dbPath: string) {
  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("../../../shared/src/db/schema");
  const seedDb = new Database(dbPath);
  migrate(seedDb);
  seedFixtureUsers(seedDb, FIXTURE_KEYS);
  seedDb.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ${fixtureUserId("u-org")}, '${fixtureDiscordId("u-org")}', 'Org'), ('g1', ${fixtureUserId("u-vict")}, '${fixtureDiscordId("u-vict")}', 'Vict')`).run();
  seedDb.prepare(`insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug) values ('g1', 'T', 'round_robin', 'pending', ${fixtureUserId("u-org")}, 'slug-1')`).run();
  const tId = (seedDb.prepare("select id from tournaments where web_slug = 'slug-1'").get() as any).id;
  const victId = (seedDb.prepare(`select id from players where user_id = ${fixtureUserId("u-vict")}`).get() as any).id;
  seedDb.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)").run(tId, victId);
  seedDb.close();
  return { victId };
}

describe("POST /api/tournaments/[slug]/kick", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DISCORD_GUILD_ID", "g1");
    auth.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DATABASE_PATH;
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("organizer can kick a participant", async () => {
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Org" } });

    const tempDir = mkdtempSync(join(tmpdir(), "tourney-kick-"));
    const dbPath = join(tempDir, "t.sqlite");
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = dbPath;

    const { victId } = await seedTournamentWithParticipants(dbPath);

    const { POST } = await import("../../app/api/tournaments/[slug]/kick/route");
    const res = await POST(
      new Request("http://localhost/api/tournaments/slug-1/kick", {
        method: "POST",
        body: JSON.stringify({ playerId: victId }),
      }),
      { params: Promise.resolve({ slug: "slug-1" }) },
    );
    expect(res.status).toBe(200);

    const Database = (await import("better-sqlite3")).default;
    const verifyDb = new Database(dbPath);
    const count = (verifyDb.prepare("select count(*) as c from tournament_participants").get() as any).c;
    verifyDb.close();
    expect(count).toBe(0);
  });

  it("non-organizer cannot kick", async () => {
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-vict")), discordUserId: fixtureDiscordId("u-vict"), name: "Vict" } });

    const tempDir = mkdtempSync(join(tmpdir(), "tourney-kick-2-"));
    const dbPath = join(tempDir, "t.sqlite");
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = dbPath;

    await seedTournamentWithParticipants(dbPath);

    const { POST } = await import("../../app/api/tournaments/[slug]/kick/route");
    const res = await POST(
      new Request("http://localhost/api/tournaments/slug-1/kick", {
        method: "POST",
        body: JSON.stringify({ playerId: 999 }),
      }),
      { params: Promise.resolve({ slug: "slug-1" }) },
    );
    expect(res.status).toBe(403);
  });
});

const FIXTURE_KEYS = ["u-org", "u-vict"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
