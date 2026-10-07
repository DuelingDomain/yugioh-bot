import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const broadcaster = { draft: vi.fn(), tournament: vi.fn() };
const tempDirs: string[] = [];

vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/notify", () => ({ broadcaster, announcer: { announce: vi.fn() } }));

describe("draftTestBotsEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on outside production and off in production without the flag", async () => {
    const { draftTestBotsEnabled } = await import("../src/lib/draft-test-bots");
    vi.stubEnv("NODE_ENV", "development");
    expect(draftTestBotsEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(draftTestBotsEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(draftTestBotsEnabled()).toBe(false);
  });

  it("opens in production only when DRAFT_TEST_BOTS is exactly 1", async () => {
    const { draftTestBotsEnabled } = await import("../src/lib/draft-test-bots");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DRAFT_TEST_BOTS", "1");
    expect(draftTestBotsEnabled()).toBe(true);
    for (const value of ["", "0", "true", "yes"]) {
      vi.stubEnv("DRAFT_TEST_BOTS", value);
      expect(draftTestBotsEnabled()).toBe(false);
    }
  });
});

describe("test bots in a production build", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    broadcaster.draft.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("host")), discordUserId: fixtureDiscordId("host"), name: "Yugi" } });
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setup() {
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-test-bots-"));
    const dbPath = join(tempDir, "bots.sqlite");
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "guild-1";

    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("@yugidraft/shared/db");
    const { createDraftService, createPlayerService } = await import("@yugidraft/shared/services");
    const db = new Database(dbPath);
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);
    const ins = db.prepare(
      "insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,?,?,?,?,?)",
    );
    const ids = Array.from({ length: 24 }, (_, i) => 500 + i);
    for (const id of ids) ins.run(id, `Card ${id}`, "Effect Monster", "effect", "i", "i", "[]", "t");
    const host = createPlayerService(db).findOrCreate("guild-1", fixtureUserId("host"), "Yugi");
    const drafts = createDraftService(db);
    const draft = drafts.create(
      "guild-1",
      "channel-1",
      "bot night",
      { setNames: [], customCardIds: ids, cubeCardIds: ids, packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6 },
      fixtureUserId("host"),
      host.id,
    );
    db.close();
    return { draft, dbPath, hostPlayerId: host.id };
  }

  const addBot = async (slug: string) => {
    const { POST } = await import("../app/api/drafts/[slug]/join-bot/route");
    return POST(new Request(`http://localhost/api/drafts/${slug}/join-bot`, { method: "POST" }), {
      params: Promise.resolve({ slug }),
    });
  };

  it("keeps join-bot a 404 without the flag", async () => {
    const { draft } = await setup();
    const res = await addBot(draft.webSlug!);
    expect(res.status).toBe(404);
  });

  it("keeps join-bot a 404 when the flag is not exactly 1", async () => {
    vi.stubEnv("DRAFT_TEST_BOTS", "true");
    const { draft } = await setup();
    expect((await addBot(draft.webSlug!)).status).toBe(404);
  });

  it("adds a bot with DRAFT_TEST_BOTS=1, still host-only", async () => {
    vi.stubEnv("DRAFT_TEST_BOTS", "1");
    const { draft } = await setup();

    auth.mockResolvedValue({ user: { id: String(fixtureUserId("someone-else")), discordUserId: fixtureDiscordId("someone-else") } });
    expect((await addBot(draft.webSlug!)).status).toBe(403);

    auth.mockResolvedValue({ user: { id: String(fixtureUserId("host")), discordUserId: fixtureDiscordId("host") } });
    const res = await addBot(draft.webSlug!);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, displayName: "Bot 1" });
  });

  it("tells the page whether bots are allowed, from the server", async () => {
    const { draft } = await setup();
    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");
    expect((await buildDraftResponse(draft.webSlug!, { userId: fixtureUserId("host"), discordUserId: fixtureDiscordId("host") }))?.botsEnabled).toBe(false);
    vi.stubEnv("DRAFT_TEST_BOTS", "1");
    expect((await buildDraftResponse(draft.webSlug!, { userId: fixtureUserId("host"), discordUserId: fixtureDiscordId("host") }))?.botsEnabled).toBe(true);
  });

  it("bots pick after the human with no dev gate: a full booster draft finishes", async () => {
    vi.stubEnv("DRAFT_TEST_BOTS", "1");
    const { draft, dbPath, hostPlayerId } = await setup();
    expect((await addBot(draft.webSlug!)).status).toBe(200);
    expect((await addBot(draft.webSlug!)).status).toBe(200);

    const Database = (await import("better-sqlite3")).default;
    const { createDraftService } = await import("@yugidraft/shared/services");
    const db = new Database(dbPath);
    const drafts = createDraftService(db);
    drafts.start(draft.id);

    const { POST } = await import("../app/api/drafts/[slug]/pick/route");
    // The host is the only human; every host pick must drag both bots along with it.
    for (let i = 0; i < 6; i += 1) {
      const options = drafts.currentPackOptions(draft.id, hostPlayerId);
      expect(options.length).toBeGreaterThan(0);
      const res = await POST(
        new Request("http://localhost/pick", { method: "POST", body: JSON.stringify({ cardId: options[0].id }) }) as NextRequest,
        { params: Promise.resolve({ slug: draft.webSlug! }) },
      );
      expect(res.status).toBe(200);
    }

    expect(drafts.findById(draft.id).status).toBe("completed");
    const perPlayer = db
      .prepare("select player_id, count(*) as n from draft_picks where draft_id = ? group by player_id")
      .all(draft.id) as Array<{ n: number }>;
    expect(perPlayer).toHaveLength(3);
    expect(perPlayer.every((r) => r.n === 6)).toBe(true);
    db.close();
  }, 30000);
});

const FIXTURE_KEYS = ["host", "someone-else"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
