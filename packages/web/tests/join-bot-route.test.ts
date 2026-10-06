import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const broadcaster = { draft: vi.fn(), tournament: vi.fn() };
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({
  auth,
}));

vi.mock("@/lib/notify", () => ({
  broadcaster,
  announcer: { announce: vi.fn() },
}));

async function createPendingDraftDb() {
  const tempDir = mkdtempSync(join(tmpdir(), "yugioh-join-bot-route-"));
  const dbPath = join(tempDir, "join-bot-route.sqlite");
  tempDirs.push(tempDir);

  process.env.DATABASE_PATH = dbPath;
  process.env.DISCORD_GUILD_ID = "guild-1";
  process.env.WS_INTERNAL_URL = "http://ws:3001";
  process.env.WS_INTERNAL_SECRET = "secret";

  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const { createDraftService, createPlayerService } = await import("@yugidraft/shared/services");
  const db = new Database(dbPath);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);

  const players = createPlayerService(db);
  const creator = players.findOrCreate("guild-1", fixtureUserId("creator-user"), "Yugi");
  const drafts = createDraftService(db);
  const draft = drafts.create(
    "guild-1",
    "channel-1",
    "pending bot draft",
    { setNames: ["Metal Raiders"], packSize: 2, packsPerPlayer: 1 },
    fixtureUserId("creator-user"),
    creator.id,
  );

  db.close();

  return draft;
}

describe("POST /api/drafts/[slug]/join-bot", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    broadcaster.draft.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("creator-user")), discordUserId: fixtureDiscordId("creator-user"), name: "Yugi" } });
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.WS_INTERNAL_URL;
    delete process.env.WS_INTERNAL_SECRET;

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("broadcasts seats after adding the dev bot", async () => {
    const draft = await createPendingDraftDb();
    const { POST } = await import("../app/api/drafts/[slug]/join-bot/route");

    const response = await POST(new Request(`http://localhost/api/drafts/${draft.webSlug}/join-bot`, { method: "POST" }), {
      params: Promise.resolve({ slug: draft.webSlug ?? "" }),
    });

    expect(response.status).toBe(200);
    expect(broadcaster.draft).toHaveBeenCalledOnce();
    expect(broadcaster.draft).toHaveBeenCalledWith(
      { kind: "seats", slug: draft.webSlug },
    );
  });

  it("adds multiple distinct bots to the same draft", async () => {
    const draft = await createPendingDraftDb();
    const { POST } = await import("../app/api/drafts/[slug]/join-bot/route");

    const makeRequest = () =>
      POST(new Request(`http://localhost/api/drafts/${draft.webSlug}/join-bot`, { method: "POST" }), {
        params: Promise.resolve({ slug: draft.webSlug ?? "" }),
      });

    const first = await makeRequest();
    const second = await makeRequest();
    const third = await makeRequest();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);

    const firstBody = await first.json();
    const secondBody = await second.json();
    const thirdBody = await third.json();

    const playerIds = [firstBody.playerId, secondBody.playerId, thirdBody.playerId];
    expect(new Set(playerIds).size).toBe(3);

    const names = [firstBody.displayName, secondBody.displayName, thirdBody.displayName];
    expect(new Set(names).size).toBe(3);
  });

  it("rejects anyone other than the draft host", async () => {
    const draft = await createPendingDraftDb();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("other-member")), discordUserId: fixtureDiscordId("other-member") } });
    const { POST } = await import("../app/api/drafts/[slug]/join-bot/route");
    const res = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ slug: draft.webSlug ?? "" }),
    });
    expect(res.status).toBe(403);
    const { getDb } = await import("../src/lib/db");
    expect(getDb().prepare("select count(*) as n from draft_players where draft_id = ?").get(draft.id)).toEqual({ n: 1 });
  });
});

const FIXTURE_KEYS = ["creator-user", "other-member"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
