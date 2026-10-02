import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ broadcaster: { draft: vi.fn() }, announcer: { announce: vi.fn() } }));

type SeedCube = { main: number; extra: number };

async function seedDraft(cubes: SeedCube[], configOverrides: Record<string, unknown> = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "yugioh-theme-lobby-"));
  const dbPath = join(tempDir, "lobby.sqlite");
  tempDirs.push(tempDir);
  process.env.DATABASE_PATH = dbPath;
  process.env.DISCORD_GUILD_ID = "guild-1";

  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const db = new Database(dbPath);
  migrate(db);
  db.exec("begin");

  const p1 = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild-1','u1','P1')").run().lastInsertRowid);
  const p2 = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild-1','u2','P2')").run().lastInsertRowid);

  const insCard = db.prepare(
    "insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,?,?,?,?,?)",
  );
  let cardId = 1;
  const cubeIds: number[] = [];
  for (const t of cubes) {
    const cubeId = Number(db.prepare("insert into cubes (guild_id, name, created_by_user_id, created_at, updated_at) values ('guild-1', ?, 'u', 't', 't')").run(`Theme${cubeIds.length}`).lastInsertRowid);
    for (let i = 0; i < t.main; i++) {
      insCard.run(cardId, `M${cardId}`, "Normal Monster", "normal", "i", "i", "[]", "t");
      db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (?, ?, 'main', 1)").run(cubeId, cardId);
      cardId++;
    }
    for (let i = 0; i < t.extra; i++) {
      insCard.run(cardId, `X${cardId}`, "XYZ Monster", "xyz", "i", "i", "[]", "t");
      db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (?, ?, 'extra', 1)").run(cubeId, cardId);
      cardId++;
    }
    cubeIds.push(cubeId);
  }

  const config = {
    mode: "theme",
    allowedCubeIds: cubeIds,
    themeSelection: "player_pick",
    uniqueThemes: true,
    themePackSize: 3,
    cardsPerPlayer: 40,
    extraDeckEnabled: true,
    extraDeckSize: 15,
    burnUnpicked: false,
    pickSeconds: 45,
    ...configOverrides,
  };
  const draftId = Number(
    db
      .prepare(
        "insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug, current_wave_number, current_pick_step) values ('guild-1','c','Theme Night','pending','u1',?,?,0,0)",
      )
      .run(JSON.stringify(config), "theme-slug").lastInsertRowid,
  );
  db.prepare("insert into draft_players (draft_id, player_id) values (?, ?)").run(draftId, p1);
  db.prepare("insert into draft_players (draft_id, player_id) values (?, ?)").run(draftId, p2);
  db.exec("commit");
  db.close();

  return { cubeIds, p1, p2 };
}

describe("theme lobby routes", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("claims a cube and rejects a second claim of the same cube (uniqueThemes)", async () => {
    const { cubeIds } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }]);
    const { POST } = await import("../app/api/drafts/[slug]/claim-cube/route");

    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const res1 = await POST(new Request("http://localhost/api/drafts/theme-slug/claim-cube", { method: "POST", body: JSON.stringify({ cubeId: cubeIds[0] }) }) as any, { params: Promise.resolve({ slug: "theme-slug" }) });
    expect(res1.status).toBe(200);

    auth.mockResolvedValue({ user: { id: "u2", name: "P2" } });
    const res2 = await POST(new Request("http://localhost/api/drafts/theme-slug/claim-cube", { method: "POST", body: JSON.stringify({ cubeId: cubeIds[0] }) }) as any, { params: Promise.resolve({ slug: "theme-slug" }) });
    expect(res2.status).toBe(409);
  }, 30000);

  it("preflight reports an error for a main-short cube and a warning for a thin-extra cube", async () => {
    await seedDraft([{ main: 5, extra: 0 }, { main: 42, extra: 0 }]);
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
    const res = await GET(new Request("http://x") as any, { params: Promise.resolve({ slug: "theme-slug" }) });
    const body = await res.json();
    expect(body.errors.length).toBeGreaterThan(0); // Theme0 main-short
    expect(body.errors.some((e: string) => /main/i.test(e))).toBe(true);
    expect(body.warnings.length).toBeGreaterThan(0); // Theme1 has 0 extra but extra enabled
  }, 30000);

  it("does not let a player who has not joined reserve a cube", async () => {
    const { cubeIds } = await seedDraft([{ main: 42, extra: 0 }]);
    const { getDb } = await import("../src/lib/db");
    getDb().prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild-1','outsider','Other')").run();
    auth.mockResolvedValue({ user: { id: "outsider" } });
    const { POST } = await import("../app/api/drafts/[slug]/claim-cube/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ cubeId: cubeIds[0] }) }), {
      params: Promise.resolve({ slug: "theme-slug" }),
    });
    expect(res.status).toBe(403);
    expect(getDb().prepare("select count(*) as n from draft_player_cube").get()).toEqual({ n: 0 });
  }, 30000);

  describe.each(["random", "player_pick"])("deleted attachments (%s)", (themeSelection) => {
    it.each(["timer-only", "config round-trip"])("allows a %s edit", async (edit) => {
      const { cubeIds } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], {
        themeSelection, extraDeckEnabled: false,
      });
      const { getDb } = await import("../src/lib/db");
      const { createCubeService, createCardCatalogService } = await import("@yugidraft/shared/services");
      const db = getDb();
      createCubeService(db, createCardCatalogService(db)).deleteCube(cubeIds[0]);
      auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
      const { GET, PUT } = await import("../app/api/drafts/[slug]/route");
      const context = { params: Promise.resolve({ slug: "theme-slug" }) };
      const current = await (await GET(new Request("http://x"), context)).json();
      expect(current.config.allowedCubeIds).toEqual(cubeIds);
      expect(current.allowedCubes.map((cube: { id: number }) => cube.id)).toEqual([cubeIds[1]]);
      const body = { config: { ...(edit === "config round-trip" ? current.config : {}), pickSeconds: 60 } };

      const response = await PUT(new Request("http://x", {
        method: "PUT", body: JSON.stringify(body),
      }) as NextRequest, context);

      expect(response.status).toBe(200);
      const updated = await response.json();
      expect(updated.config.allowedCubeIds).toEqual(cubeIds);
      expect(updated.config.themeSelection).toBe(themeSelection);
      expect(updated.config.pickSeconds).toBe(60);
      expect(updated.name).toBe("Theme Night");
      const stored = db.prepare("select name, config_json, status from drafts where id = 1").get() as {
        name: string; config_json: string; status: string;
      };
      expect(stored.name).toBe(updated.name);
      expect(JSON.parse(stored.config_json)).toEqual(updated.config);
      expect(stored.status).toBe("pending");
    }, 30000);

    it("preflight skips deleted attachments", async () => {
      const { cubeIds } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], {
        themeSelection, extraDeckEnabled: false,
      });
      const { getDb } = await import("../src/lib/db");
      const { createCubeService, createCardCatalogService } = await import("@yugidraft/shared/services");
      const db = getDb();
      createCubeService(db, createCardCatalogService(db)).deleteCube(cubeIds[0]);
      auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
      const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
      const response = await GET(new Request("http://x"), { params: Promise.resolve({ slug: "theme-slug" }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ errors: [], warnings: [] });
    }, 30000);

    it("starts using surviving cubes after an attachment is deleted", async () => {
      const { cubeIds } = await seedDraft([
        { main: 42, extra: 0 }, { main: 42, extra: 0 }, { main: 42, extra: 0 },
      ], { themeSelection, extraDeckEnabled: false });
      const { getDb } = await import("../src/lib/db");
      const { createCubeService, createCardCatalogService } = await import("@yugidraft/shared/services");
      const db = getDb();
      createCubeService(db, createCardCatalogService(db)).deleteCube(cubeIds[0]);
      auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
      const { POST } = await import("../app/api/drafts/[slug]/route");
      const response = await POST(new Request("http://x", { method: "POST" }), {
        params: Promise.resolve({ slug: "theme-slug" }),
      });
      expect(response.status).toBe(200);
      expect(db.prepare("select status from drafts where id = 1").get()).toEqual({ status: "active" });
      expect(db.prepare("select cube_id from draft_player_cube where draft_id = 1 order by cube_id").all())
        .toEqual([{ cube_id: cubeIds[1] }, { cube_id: cubeIds[2] }]);
    }, 30000);
  });

  describe.each(["random", "player_pick"])("attachments moved to another guild (%s)", (themeSelection) => {
    it.each(["timer-only", "config round-trip"])("rejects a %s edit before changing the draft", async (edit) => {
      const { cubeIds } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], {
        themeSelection, extraDeckEnabled: false,
      });
      const { getDb } = await import("../src/lib/db");
      const db = getDb();
      db.prepare("update cubes set guild_id = 'other-guild' where id = ?").run(cubeIds[0]);
      const before = db.prepare("select name, config_json from drafts where id = 1").get();
      auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
      const { PUT } = await import("../app/api/drafts/[slug]/route");
      const response = await PUT(new Request("http://x", {
        method: "PUT", body: JSON.stringify({ name: "Renamed", config: {
          pickSeconds: 60, ...(edit === "config round-trip" ? { allowedCubeIds: cubeIds } : {}),
        } }),
      }) as NextRequest, { params: Promise.resolve({ slug: "theme-slug" }) });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Cube not found" });
      expect(db.prepare("select name, config_json from drafts where id = 1").get()).toEqual(before);
    }, 30000);

    it("rejects start before dealing cards", async () => {
      const { cubeIds } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], {
        themeSelection, extraDeckEnabled: false,
      });
      const { getDb } = await import("../src/lib/db");
      const db = getDb();
      db.prepare("update cubes set guild_id = 'other-guild' where id = ?").run(cubeIds[0]);
      auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
      const { POST } = await import("../app/api/drafts/[slug]/route");
      const response = await POST(new Request("http://x", { method: "POST" }), {
        params: Promise.resolve({ slug: "theme-slug" }),
      });
      expect(response.status).toBe(404);
      expect(db.prepare("select status from drafts where id = 1").get()).toEqual({ status: "pending" });
      expect(db.prepare("select count(*) as n from draft_cards").get()).toEqual({ n: 0 });
    }, 30000);
  });

  it("allows claiming a surviving cube but rejects claiming the deleted attachment", async () => {
    const { cubeIds, p1 } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }]);
    const { getDb } = await import("../src/lib/db");
    const { createCubeService, createCardCatalogService } = await import("@yugidraft/shared/services");
    const db = getDb();
    createCubeService(db, createCardCatalogService(db)).deleteCube(cubeIds[0]);
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { POST } = await import("../app/api/drafts/[slug]/claim-cube/route");
    const context = { params: Promise.resolve({ slug: "theme-slug" }) };
    const claim = (cubeId: number) => POST(new Request("http://x", {
      method: "POST", body: JSON.stringify({ cubeId }),
    }), context);
    expect((await claim(cubeIds[1])).status).toBe(200);
    expect((await claim(cubeIds[0])).status).toBe(404);
    expect(db.prepare("select cube_id from draft_player_cube where draft_id = 1 and player_id = ?").get(p1))
      .toEqual({ cube_id: cubeIds[1] });
  }, 30000);

  it("creation still rejects a deleted cube ID", async () => {
    const { cubeIds } = await seedDraft([{ main: 42, extra: 0 }]);
    const { getDb } = await import("../src/lib/db");
    const { createCubeService, createCardCatalogService } = await import("@yugidraft/shared/services");
    const db = getDb();
    createCubeService(db, createCardCatalogService(db)).deleteCube(cubeIds[0]);
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { POST } = await import("../app/api/drafts/route");
    const response = await POST(new Request("http://x", {
      method: "POST", body: JSON.stringify({ name: "New Draft", channelId: "c", config: {
        mode: "theme", allowedCubeIds: cubeIds,
      } }),
    }) as NextRequest);
    expect(response.status).toBe(404);
    expect(db.prepare("select count(*) as n from drafts").get()).toEqual({ n: 1 });
  }, 30000);

  it.each(["foreign", "unallowed-local"])("rejects a poisoned %s player claim before start", async (kind) => {
    const { cubeIds, p1, p2 } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], { extraDeckEnabled: false });
    const { getDb } = await import("../src/lib/db");
    const db = getDb();
    const poisonedId = Number(db.prepare("insert into cubes (guild_id, name, created_by_user_id) values (?, 'Poisoned', 'u1')").run(kind === "foreign" ? "other-guild" : "guild-1").lastInsertRowid);
    db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) select ?, catalog_card_id, pool, max_copies from cube_cards where cube_id = ?").run(poisonedId, cubeIds[0]);
    db.prepare("insert into draft_player_cube (draft_id, player_id, cube_id) values (1, ?, ?), (1, ?, ?)").run(p1, poisonedId, p2, cubeIds[1]);
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { POST } = await import("../app/api/drafts/[slug]/route");
    const response = await POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ slug: "theme-slug" }) });
    expect(response.status).toBe(kind === "foreign" ? 404 : 400);
    expect(db.prepare("select status from drafts where id = 1").get()).toEqual({ status: "pending" });
    expect(db.prepare("select count(*) as n from draft_cards").get()).toEqual({ n: 0 });
  }, 30000);

});
