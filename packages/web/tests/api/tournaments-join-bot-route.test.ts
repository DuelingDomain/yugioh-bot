import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "../fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const broadcaster = { draft: vi.fn(), tournament: vi.fn() };
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ broadcaster, announcer: { announce: vi.fn() } }));

async function createPendingTournamentDb() {
  const tempDir = mkdtempSync(join(tmpdir(), "yugioh-tournament-join-bot-route-"));
  const dbPath = join(tempDir, "tournament-join-bot-route.sqlite");
  tempDirs.push(tempDir);

  process.env.DATABASE_PATH = dbPath;
  process.env.WS_INTERNAL_URL = "http://ws:3001";
  process.env.WS_INTERNAL_SECRET = "secret";

  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const { createPlayerService } = await import("@yugidraft/shared/services");
  const db = new Database(dbPath);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);

  const players = createPlayerService(db);
  const organizer = players.findOrCreate("g1", fixtureUserId("u-org"), "Organizer");
  const outsider = players.findOrCreate("g1", fixtureUserId("u-out"), "Outsider");

  const result = db
    .prepare("insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug) values (?, ?, ?, 'pending', ?, ?)")
    .run("g1", "Test Cup", "single_elim", fixtureUserId("u-org"), "slug-1");

  const tournamentId = Number(result.lastInsertRowid);
  db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)").run(tournamentId, organizer.id);
  db.close();

  return { tournamentId, organizer, outsider };
}

describe("POST /api/tournaments/[slug]/join-bot", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DISCORD_GUILD_ID", "g1");
    auth.mockReset();
    broadcaster.tournament.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-org")), discordUserId: fixtureDiscordId("u-org"), name: "Organizer" } });
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DATABASE_PATH;
    delete process.env.WS_INTERNAL_URL;
    delete process.env.WS_INTERNAL_SECRET;

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds a bot participant for the organizer on a pending tournament", async () => {
    await createPendingTournamentDb();
    const { POST } = await import("../../app/api/tournaments/[slug]/join-bot/route");

    const response = await POST(new Request("http://localhost/api/tournaments/slug-1/join-bot", { method: "POST" }), {
      params: Promise.resolve({ slug: "slug-1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.displayName).toBe("Bot 1");
    expect(broadcaster.tournament).toHaveBeenCalledOnce();
  });

  it("adds distinct bots on repeated requests", async () => {
    await createPendingTournamentDb();
    const { POST } = await import("../../app/api/tournaments/[slug]/join-bot/route");

    const first = await POST(new Request("http://localhost/api/tournaments/slug-1/join-bot", { method: "POST" }), {
      params: Promise.resolve({ slug: "slug-1" }),
    });
    const second = await POST(new Request("http://localhost/api/tournaments/slug-1/join-bot", { method: "POST" }), {
      params: Promise.resolve({ slug: "slug-1" }),
    });

    expect((await first.json()).displayName).toBe("Bot 1");
    expect((await second.json()).displayName).toBe("Bot 2");
  });

  it("rejects non-organizers", async () => {
    await createPendingTournamentDb();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-out")), discordUserId: fixtureDiscordId("u-out"), name: "Outsider" } });
    const { POST } = await import("../../app/api/tournaments/[slug]/join-bot/route");

    const response = await POST(new Request("http://localhost/api/tournaments/slug-1/join-bot", { method: "POST" }), {
      params: Promise.resolve({ slug: "slug-1" }),
    });

    expect(response.status).toBe(403);
  });
});

const FIXTURE_KEYS = ["u-org", "u-out"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
