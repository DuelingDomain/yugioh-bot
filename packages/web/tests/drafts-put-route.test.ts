import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const syncDraftPool = vi.fn().mockResolvedValue([]);
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));

// Prevent syncDraftPool from making real network calls — the route calls it to
// refresh the catalog but our test data is already in the DB.
vi.mock("@yugidraft/shared/services", async (importOriginal) => {
  const original = await importOriginal<typeof import("@yugidraft/shared/services")>();
  return {
    ...original,
    createCardCatalogService: (db: any) => ({
      ...original.createCardCatalogService(db),
      syncDraftPool,
    }),
  };
});

describe("PUT /api/drafts/[slug]", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    syncDraftPool.mockReset().mockResolvedValue([]);
    auth.mockResolvedValue({ user: { id: "creator-user", name: "Yugi" } });
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.DISCORD_DEFAULT_CHANNEL_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setupDraftWithCustomPool() {
    const tempDir = mkdtempSync(join(tmpdir(), "yugioh-put-route-"));
    const dbPath = join(tempDir, "test.sqlite");
    tempDirs.push(tempDir);
    process.env.DATABASE_PATH = dbPath;
    process.env.DISCORD_GUILD_ID = "guild-1";
    process.env.DISCORD_DEFAULT_CHANNEL_ID = "channel-1";

    const Database = (await import("better-sqlite3")).default;
    const { migrate } = await import("@yugidraft/shared/db");
    const db = new Database(dbPath);
    migrate(db);

    // Seed catalog cards (enough distinct to pass the create/edit feasibility check)
    for (let i = 1; i <= 30; i++) {
      db.prepare(
        `insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
         values (?, ?, 'Effect Monster', 'effect', '', '', '[]', current_timestamp)`,
      ).run(i, `Card ${i}`);
    }

    db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild-1', 'creator-user', 'Yugi')").run();
    const playerRow = db.prepare("select id from players where discord_user_id = 'creator-user'").get() as { id: number };

    const customCardIds = Array.from({ length: 30 }, (_, i) => i + 1);
    db.prepare(
      `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug)
       values ('guild-1', 'channel-1', 'My Draft', 'pending', 'creator-user', ?, 'test-slug')`,
    ).run(JSON.stringify({
      customCardIds,
      setNames: [],
      packsPerPlayer: 5,
      packSize: 8,
      pickSeconds: 45,
      poolCardIds: customCardIds,
    }));
    db.prepare("insert into draft_players (draft_id, player_id) values (1, ?)").run(playerRow.id);
    db.close();

    return dbPath;
  }

  it("keeps the stored deal and config when start wins an edit race", async () => {
    await setupDraftWithCustomPool();
    const { getDb } = await import("@/lib/db");
    const { createDraftService, createPlayerService } = await import("@yugidraft/shared/services");
    const db = getDb();
    const copies = Array.from({ length: 30 }, (_, i) => Array(3).fill(i + 1)).flat();
    db.prepare("update drafts set config_json = ? where id = 1").run(JSON.stringify({ customCardIds: copies, packSize: 8, packsPerPlayer: 5, cardsPerPlayer: 40 }));
    const drafts = createDraftService(db, { seedSource: () => 7 });
    const other = createPlayerService(db).findOrCreate("guild-1", "other", "Kaiba");
    drafts.join(1, other.id);
    let storedConfig: unknown;
    let storedDeal: unknown;
    syncDraftPool.mockImplementationOnce(async () => {
      drafts.start(1);
      storedConfig = db.prepare("select config_json from drafts where id = 1").get();
      storedDeal = db.prepare("select * from draft_deal where draft_id = 1 order by position").all();
      return [];
    });
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://localhost/api/drafts/test-slug", {
      method: "PUT", body: JSON.stringify({ name: "Changed", config: { cardsPerPlayer: 60, packSize: 15, copyLimit: false } }),
    }) as NextRequest, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Can only modify pending drafts");
    expect(db.prepare("select config_json from drafts where id = 1").get()).toEqual(storedConfig);
    expect(db.prepare("select * from draft_deal where draft_id = 1 order by position").all()).toEqual(storedDeal);
    expect(db.prepare("select status, name from drafts where id = 1").get()).toEqual({ status: "active", name: "My Draft" });
  });

  it("renames a pending draft and can keep its current name", async () => {
    await setupDraftWithCustomPool();
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    for (let i = 0; i < 2; i++) {
      const response = await PUT(new Request("http://localhost/api/drafts/test-slug", {
        method: "PUT", body: JSON.stringify({ name: "Renamed Draft" }),
      }) as NextRequest, { params: Promise.resolve({ slug: "test-slug" }) });
      expect(response.status).toBe(200);
      expect((await response.json()).name).toBe("Renamed Draft");
    }
    const { getDb } = await import("@/lib/db");
    expect(getDb().prepare("select name from drafts where web_slug = 'test-slug'").get()).toEqual({ name: "Renamed Draft" });
  });

  it.each(["pending", "active"])("rejects a rename colliding with a %s draft in the same guild", async (status) => {
    await setupDraftWithCustomPool();
    const { getDb } = await import("@/lib/db");
    getDb().prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug) values ('guild-1', 'channel-1', 'Existing Draft', ?, 'other-user', '{}', 'other-slug')").run(status);
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://localhost/api/drafts/test-slug", {
      method: "PUT", body: JSON.stringify({ name: "Existing Draft" }),
    }) as NextRequest, { params: Promise.resolve({ slug: "test-slug" }) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/name already exists/i);
    expect(getDb().prepare("select name from drafts where web_slug = 'test-slug'").get()).toEqual({ name: "My Draft" });
  });

  it.each(["completed", "cancelled"])("allows a rename matching a %s draft in the same guild", async (status) => {
    await setupDraftWithCustomPool();
    const { getDb } = await import("@/lib/db");
    getDb().prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug) values ('guild-1', 'channel-1', 'Existing Draft', ?, 'other-user', '{}', 'other-slug')").run(status);
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://localhost/api/drafts/test-slug", {
      method: "PUT", body: JSON.stringify({ name: "Existing Draft" }),
    }) as NextRequest, { params: Promise.resolve({ slug: "test-slug" }) });

    expect(response.status).toBe(200);
    expect((await response.json()).name).toBe("Existing Draft");
    expect(getDb().prepare("select name from drafts where web_slug = 'test-slug'").get()).toEqual({ name: "Existing Draft" });
    expect(getDb().prepare("select status from drafts where web_slug = 'other-slug'").get()).toEqual({ status });
  });

  it("allows a rename matching a draft in another guild", async () => {
    await setupDraftWithCustomPool();
    const { getDb } = await import("@/lib/db");
    getDb().prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug) values ('guild-2', 'channel-2', 'Existing Draft', 'pending', 'other-user', '{}', 'other-slug')").run();
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://localhost/api/drafts/test-slug", {
      method: "PUT", body: JSON.stringify({ name: "Existing Draft" }),
    }) as NextRequest, { params: Promise.resolve({ slug: "test-slug" }) });

    expect(response.status).toBe(200);
    expect((await response.json()).name).toBe("Existing Draft");
    expect(getDb().prepare("select name from drafts where web_slug = 'test-slug'").get()).toEqual({ name: "Existing Draft" });
  });

  it("merges config without dropping customCardIds when only numeric fields sent", async () => {
    await setupDraftWithCustomPool();
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const request = new Request("http://localhost/api/drafts/test-slug", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { packsPerPlayer: 3 } }),
    }) as NextRequest;

    const response = await PUT(request, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.config.customCardIds).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));

    expect(data.config.packSize).toBe(8); // Retain the configured pack size.
    expect(data.config.packsPerPlayer).toBe(5);
  });

  it("keeps fifteen-card packs in a sixty-card draft", async () => {
    await setupDraftWithCustomPool();
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ config: { cardsPerPlayer: 60, packSize: 15 } }) }) as NextRequest, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).config).toMatchObject({ cardsPerPlayer: 60, packSize: 15, packsPerPlayer: 4 });
  });

  it.each([0, 4, 61, 5.5])("rejects bad pack size %s", async (packSize) => {
    await setupDraftWithCustomPool();
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ config: { packSize } }) }) as NextRequest, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(400);
  });

  async function putConfig(config: Record<string, unknown>) {
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://localhost/api/drafts/test-slug", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    }) as NextRequest, { params: Promise.resolve({ slug: "test-slug" }) });
    return { response, data: await response.json() };
  }

  it("stores the lobby's pack fields as typed: 40 cards in packs of 15", async () => {
    await setupDraftWithCustomPool();
    const { response, data } = await putConfig({ cardsPerPlayer: 40, packSize: 15, packsPerPlayer: 3 });
    expect(response.status).toBe(200);
    expect(data.config.cardsPerPlayer).toBe(40);
    expect(data.config.packSize).toBe(15);
    expect(data.config.packsPerPlayer).toBe(3);
  });

  it("derives the pack count from cards per player and pack size, and rejects junk without changing the draft", async () => {
    await setupDraftWithCustomPool();
    const derived = await putConfig({ cardsPerPlayer: 45, packSize: 10 });
    expect(derived.data.config).toMatchObject({ cardsPerPlayer: 45, packSize: 10, packsPerPlayer: 5 });
    const junk = await putConfig({ cardsPerPlayer: "lots", packSize: -3 });
    expect(junk.response.status).toBe(400);
    const { getDb } = await import("@/lib/db");
    const stored = JSON.parse((getDb().prepare("select config_json from drafts where web_slug='test-slug'").get() as { config_json: string }).config_json);
    expect(stored).toMatchObject({ cardsPerPlayer: 45, packSize: 10, packsPerPlayer: 5 });
  });

  it("stores a poolSource that names a cube in this guild, with the cube's name from the database", async () => {
    await setupDraftWithCustomPool();
    const { getDb } = await import("@/lib/db");
    const cubeId = Number(getDb().prepare("insert into cubes (guild_id, name, created_by_user_id) values ('guild-1','Goat','creator-user')").run().lastInsertRowid);
    const { data } = await putConfig({ poolSource: { cubeId, cubeName: "Spoofed" } });
    expect(data.config.poolSource).toEqual({ cubeId, cubeName: "Goat" });
  });

  it("drops a foreign or unknown poolSource and clears the stored one", async () => {
    await setupDraftWithCustomPool();
    const { getDb } = await import("@/lib/db");
    const own = Number(getDb().prepare("insert into cubes (guild_id, name, created_by_user_id) values ('guild-1','Goat','creator-user')").run().lastInsertRowid);
    const foreign = Number(getDb().prepare("insert into cubes (guild_id, name, created_by_user_id) values ('other-guild','Foreign','x')").run().lastInsertRowid);
    expect((await putConfig({ poolSource: { cubeId: own, cubeName: "Goat" } })).data.config.poolSource).toBeDefined();
    const dropped = await putConfig({ poolSource: { cubeId: foreign, cubeName: "Foreign" } });
    expect(dropped.data.config.poolSource).toBeUndefined();
    await putConfig({ poolSource: { cubeId: own, cubeName: "Goat" } });
    const unknown = await putConfig({ poolSource: { cubeId: 99999, cubeName: "Nope" } });
    expect(unknown.data.config.poolSource).toBeUndefined();
    expect(JSON.parse((getDb().prepare("select config_json from drafts where web_slug='test-slug'").get() as { config_json: string }).config_json).poolSource).toBeUndefined();
  });

  it("recomputes the pool from the new selection instead of reusing the stale snapshot", async () => {
    await setupDraftWithCustomPool(); // seeded with poolCardIds = [1..30]
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const reduced = Array.from({ length: 20 }, (_, i) => i + 1);
    const request = new Request("http://localhost/api/drafts/test-slug", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { setNames: [], customCardIds: reduced } }),
    }) as NextRequest;

    const response = await PUT(request, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.config.customCardIds).toEqual(reduced);
    // Materialized cube reflects the reduced selection, not the stale 30-card snapshot.
    expect(data.config.cubeCardIds).toEqual(reduced);
    expect(data.config.poolCardIds).toBeUndefined();
  });

  it("allows editing when 0 sets but customCardIds are present", async () => {
    await setupDraftWithCustomPool();
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    // packsPerPlayer defaults to 5 => packSize 8 => 2 players need 16 distinct.
    const customCardIds = Array.from({ length: 16 }, (_, i) => i + 1);
    const request = new Request("http://localhost/api/drafts/test-slug", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { setNames: [], customCardIds, pickSeconds: 60 } }),
    }) as NextRequest;

    const response = await PUT(request, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(200);
  });

  it("rejects when merged config has no pool", async () => {
    await setupDraftWithCustomPool();
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const request = new Request("http://localhost/api/drafts/test-slug", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { setNames: [], customCardIds: [] } }),
    }) as NextRequest;

    const response = await PUT(request, { params: Promise.resolve({ slug: "test-slug" }) });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/at least one set/i);
  });
});
