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

// A draft page must open for a player who reconnects. One bad part (a catalog row with broken JSON,
// a corrupt saved deck, a viewer who is not a seat in the draft) degrades that part and nothing else.

describe("draft load resilience", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    broadcaster.draft.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("host")), discordUserId: fixtureDiscordId("host"), name: "Yugi" } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setup() {
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-load-"));
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
    const ids = Array.from({ length: 16 }, (_, i) => 700 + i);
    for (const id of ids) ins.run(id, `Card ${id}`, "Effect Monster", "effect", "i", "i", "[]", "t");
    const players = createPlayerService(db);
    const host = players.findOrCreate("guild-1", fixtureUserId("host"), "Yugi");
    const other = players.findOrCreate("guild-1", fixtureUserId("other"), "Kaiba");
    const outsider = players.findOrCreate("guild-1", fixtureUserId("outsider"), "Joey");
    const drafts = createDraftService(db);
    const draft = drafts.create(
      "guild-1", "channel-1", "reconnect night",
      { setNames: [], customCardIds: ids, cubeCardIds: ids, packSize: 4, packsPerPlayer: 2, cardsPerPlayer: 8 },
      fixtureUserId("host"), host.id,
    );
    drafts.join(draft.id, other.id);
    drafts.start(draft.id);
    return { db, drafts, draft, slug: draft.webSlug!, host: host.id, other: other.id, outsider: outsider.id };
  }

  const load = async (slug: string, userId: string) => {
    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");
    return buildDraftResponse(slug, { userId: fixtureUserId(userId), discordUserId: fixtureDiscordId(userId) });
  };

  it("opens when a card in the pack has a catalog row with broken JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, drafts, draft, slug, host } = await setup();
    const pack = drafts.currentPackOptions(draft.id, host);
    db.prepare("update card_catalog set card_sets_json = 'not json' where ygoprodeck_id = ?").run(pack[0].catalogCardId);

    const response = await load(slug, "host");

    expect(response?.currentPack.map((card) => card.id)).toEqual(pack.map((card) => card.id));
    expect(response?.isMyTurn).toBe(true);
    db.close();
  });

  it("opens a finished draft when the saved deck is corrupt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, draft, slug, host } = await setup();
    db.prepare("update drafts set status = 'completed', ended_at = ? where id = ?").run(new Date().toISOString(), draft.id);
    db.prepare(
      `insert into saved_decks (guild_id, owner_user_id, name, mode, deck_json, draft_id) values ('guild-1', ${fixtureUserId("host")}, 'Deck', 'normal', '{broken', ?)`,
    ).run(draft.id);

    const response = await load(slug, "host");

    expect(response?.completed).toBe(true);
    expect(response?.myDeckId).toBeNull();
    expect(host).toBeGreaterThan(0);
    db.close();
  });

  it("opens an active draft for a viewer who has a player row but no seat", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, slug } = await setup();

    const response = await load(slug, "outsider");

    expect(response?.isParticipant).toBe(false);
    expect(response?.currentPack).toEqual([]);
    db.close();
  });

  it("fails the load when the database is locked, instead of showing stale data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, slug } = await setup();
    vi.doMock("@yugidraft/shared/services", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@yugidraft/shared/services")>();
      return {
        ...actual,
        createDraftService: (...args: Parameters<typeof actual.createDraftService>) => ({
          ...actual.createDraftService(...args),
          expireCurrentPickStep: () => {
            throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
          },
        }),
      };
    });

    await expect(load(slug, "host")).rejects.toMatchObject({ code: "SQLITE_BUSY" });
    vi.doUnmock("@yugidraft/shared/services");
    db.close();
  });

  it("logs the draft slug when the route fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, slug } = await setup();
    vi.doMock("../app/api/drafts/[slug]/helpers", () => ({
      buildDraftResponse: () => Promise.reject(new Error("boom")),
    }));

    const { GET } = await import("../app/api/drafts/[slug]/route");
    const res = await GET(new Request("http://localhost/x") as NextRequest, { params: Promise.resolve({ slug }) });

    expect(res.status).toBe(500);
    expect(logged.mock.calls.flat().join(" ")).toContain(slug);
    db.close();
  });
});

const FIXTURE_KEYS = ["host", "other", "outsider"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
