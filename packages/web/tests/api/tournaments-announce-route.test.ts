import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "../fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const tempDirs: string[] = [];

vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("../fixtures/session");
  return sessionFixture(auth);
});

async function seedTournament(dbPath: string) {
  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("../../../shared/src/db/schema");
  const db = new Database(dbPath);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ${fixtureUserId("u-org")}, '${fixtureDiscordId("u-org")}', 'Org')`).run();
  const orgPlayerId = (db.prepare(`select id from players where user_id = ${fixtureUserId("u-org")}`).get() as any).id;
  db.prepare(`insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug) values ('g1', 'My Tournament', 'round_robin', 'pending', ${fixtureUserId("u-org")}, 'slug-1')`).run();
  const tId = (db.prepare("select id from tournaments where web_slug = 'slug-1'").get() as any).id;
  db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)").run(tId, orgPlayerId);
  db.close();
}

describe("POST /api/tournaments/[slug]/announce", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DISCORD_BOT_ENABLED", "1");
    vi.stubEnv("DISCORD_GUILD_ID", "g1");
    auth.mockReset();
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "");
    vi.stubEnv("DISCORD_REMINDER_CHANNEL_ID", "");
    vi.stubEnv("BOT_ANNOUNCE_URL", "http://bot:4001");
    vi.stubEnv("BOT_ANNOUNCE_SECRET", "shh");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns 400 when no announce channel is configured", async () => {
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Org" } });
    const tempDir = mkdtempSync(join(tmpdir(), "ta-1-"));
    const dbPath = join(tempDir, "t.sqlite");
    tempDirs.push(tempDir);
    vi.stubEnv("DATABASE_PATH", dbPath);
    await seedTournament(dbPath);

    const { POST } = await import("../../app/api/tournaments/[slug]/announce/route");
    const res = await POST(new Request("http://localhost/api/tournaments/slug-1/announce", { method: "POST" }), {
      params: Promise.resolve({ slug: "slug-1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/announcement channel/i);
  });

  it("falls back to DISCORD_DEFAULT_CHANNEL_ID and POSTs to the bot announce endpoint", async () => {
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Org" } });
    vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "channel-default");

    const tempDir = mkdtempSync(join(tmpdir(), "ta-2-"));
    const dbPath = join(tempDir, "t.sqlite");
    tempDirs.push(tempDir);
    vi.stubEnv("DATABASE_PATH", dbPath);
    await seedTournament(dbPath);

    const { POST } = await import("../../app/api/tournaments/[slug]/announce/route");
    const res = await POST(new Request("http://localhost/api/tournaments/slug-1/announce", { method: "POST" }), {
      params: Promise.resolve({ slug: "slug-1" }),
    });
    expect(res.status).toBe(200);

    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://bot:4001/internal/announce/tournament-created");
    const body = JSON.parse((init as any).body as string);
    expect(body.channelId).toBe("channel-default");
    expect(body.organizerUserId).toBe(fixtureDiscordId("u-org"));
    expect(body.participantCount).toBe(1);
    expect(body.name).toBe("My Tournament");
  });

  it("returns 403 for non-organizer", async () => {
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-someone-else")), discordUserId: fixtureDiscordId("u-someone-else"), name: "Stranger" } });
    vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "channel-default");

    const tempDir = mkdtempSync(join(tmpdir(), "ta-3-"));
    const dbPath = join(tempDir, "t.sqlite");
    tempDirs.push(tempDir);
    vi.stubEnv("DATABASE_PATH", dbPath);
    await seedTournament(dbPath);

    const { POST } = await import("../../app/api/tournaments/[slug]/announce/route");
    const res = await POST(new Request("http://localhost/api/tournaments/slug-1/announce", { method: "POST" }), {
      params: Promise.resolve({ slug: "slug-1" }),
    });
    expect(res.status).toBe(403);
  });
});

const FIXTURE_KEYS = ["u-org", "u-someone-else"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
