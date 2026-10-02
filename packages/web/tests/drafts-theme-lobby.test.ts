import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const syncDraftPool = vi.fn();
const tempDirs: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ announcer: { announce: vi.fn() }, broadcaster: { draft: vi.fn() } }));
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
  db.close();

  return { cubeIds, p1, p2, dbPath };
}

describe("theme lobby routes", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    syncDraftPool.mockReset();
    syncDraftPool.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([undefined, { "1": 1 }])("rejects switching to host assignment without every player's assignment (%j)", async (themeAssignments) => {
    const { dbPath } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }]);
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://localhost/api/drafts/theme-slug", {
      method: "PUT",
      body: JSON.stringify({ config: { themeSelection: "host_assigned", themeAssignments } }),
    }) as NextRequest, { params: Promise.resolve({ slug: "theme-slug" }) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/assignment for every player/i);
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);
    const row = db.prepare("select config_json from drafts").get() as { config_json: string };
    expect(JSON.parse(row.config_json).themeSelection).toBe("player_pick");
    db.close();
  }, 30000);

  it("allows switching to fully assigned themes and starting without a booster pool", async () => {
    const { cubeIds, p1, p2 } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], { extraDeckEnabled: false });
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { PUT, POST } = await import("../app/api/drafts/[slug]/route");
    const themeAssignments = { [p1]: cubeIds[1], [p2]: cubeIds[0] };
    const response = await PUT(new Request("http://localhost/api/drafts/theme-slug", {
      method: "PUT",
      body: JSON.stringify({ config: { themeSelection: "host_assigned", themeAssignments } }),
    }) as NextRequest, { params: Promise.resolve({ slug: "theme-slug" }) });

    expect(response.status).toBe(200);
    expect((await response.json()).config).toMatchObject({ themeSelection: "host_assigned", themeAssignments });
    const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
    const preflight = await GET(new Request("http://localhost"), { params: Promise.resolve({ slug: "theme-slug" }) });
    expect((await preflight.json()).errors).toEqual([]);
    const started = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ slug: "theme-slug" }) });
    expect(started.status).toBe(200);
    expect((await started.json()).status).toBe("active");
  }, 30000);

  it("rejects start when an assigned cube moves guild during catalog sync", async () => {
    const { cubeIds, p1, p2 } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], {
      themeSelection: "host_assigned", themeAssignments: { "1": 1, "2": 2 }, extraDeckEnabled: false,
      setNames: ["Metal Raiders"],
    });
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    let releaseCatalog!: (response: Response) => void;
    let catalogRequested!: () => void;
    const catalogResponse = new Promise<Response>((resolve) => { releaseCatalog = resolve; });
    const requested = new Promise<void>((resolve) => { catalogRequested = resolve; });
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      expect(new URL(String(input)).searchParams.get("cardset")).toBe("Metal Raiders");
      catalogRequested();
      return catalogResponse;
    }));
    const original = await vi.importActual<typeof import("@yugidraft/shared/services")>("@yugidraft/shared/services");
    syncDraftPool.mockImplementationOnce(original.createCardCatalogService(db).syncDraftPool);
    const { POST } = await import("../app/api/drafts/[slug]/route");
    const starting = POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ slug: "theme-slug" }) });

    await requested;
    db.prepare("update cubes set guild_id = 'guild-2' where id = ?").run(cubeIds[1]);
    releaseCatalog(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const response = await starting;

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/exist.*draft.*guild/i);
    expect(db.prepare("select status, started_at from drafts").get()).toEqual({ status: "pending", started_at: null });
    expect(db.prepare("select seat_index from draft_players where player_id in (?, ?) order by player_id").all(p1, p2))
      .toEqual([{ seat_index: null }, { seat_index: null }]);
    expect(db.prepare("select * from draft_player_cube").all()).toEqual([]);
    expect(db.prepare("select * from draft_packs").all()).toEqual([]);
  }, 30000);

  describe.each(["edit", "preflight", "start"])("host assignment validation at %s", (entryPoint) => {
    // Unused foreign-guild cubes are rejected by the web access layer (PR #63), so only deletion is covered here.
    it("allows an unused deleted allowed theme", async () => {
      const { cubeIds, p1, p2 } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }, { main: 42, extra: 0 }], {
        themeSelection: "host_assigned", themeAssignments: { "1": 1, "2": 2 }, extraDeckEnabled: false,
      });
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      db.prepare("delete from cubes where id = ?").run(cubeIds[2]);
      auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
      const params = { params: Promise.resolve({ slug: "theme-slug" }) };

      if (entryPoint === "preflight") {
        const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
        const response = await GET(new Request("http://localhost"), params);
        expect(response.status).toBe(200);
        expect((await response.json()).errors).toEqual([]);
      } else {
        const { PUT, POST } = await import("../app/api/drafts/[slug]/route");
        const response = entryPoint === "edit"
          ? await PUT(new Request("http://localhost", {
            method: "PUT", body: JSON.stringify({ config: { pickSeconds: 60 } }),
          }) as NextRequest, params)
          : await POST(new Request("http://localhost", { method: "POST" }), params);
        expect(response.status).toBe(200);
        const body = await response.json();
        if (entryPoint === "edit") expect(body.config).toMatchObject({ pickSeconds: 60, allowedCubeIds: cubeIds, themeAssignments: { [p1]: cubeIds[0], [p2]: cubeIds[1] } });
        else {
          expect(body.status).toBe("active");
          expect(db.prepare("select player_id, cube_id from draft_player_cube order by player_id").all())
            .toEqual([{ player_id: p1, cube_id: cubeIds[0] }, { player_id: p2, cube_id: cubeIds[1] }]);
        }
      }

      const row = db.prepare("select status, config_json from drafts").get() as { status: string; config_json: string };
      expect(row.status).toBe(entryPoint === "start" ? "active" : "pending");
      expect(JSON.parse(row.config_json).pickSeconds).toBe(entryPoint === "edit" ? 60 : 45);
    }, 30000);

    it.each(["foreign-guild", "deleted", "nonexistent"])("rejects a %s assigned theme", async (invalidCube) => {
      await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], {
        themeSelection: "host_assigned",
        themeAssignments: { "1": 1, "2": invalidCube === "nonexistent" ? 999 : 2 },
        allowedCubeIds: [1, invalidCube === "nonexistent" ? 999 : 2],
        extraDeckEnabled: false,
      });
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      if (invalidCube === "foreign-guild") db.prepare("update cubes set guild_id = 'guild-2' where id = 2").run();
      if (invalidCube === "deleted") db.prepare("delete from cubes where id = 2").run();
      auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
      const params = { params: Promise.resolve({ slug: "theme-slug" }) };

      if (entryPoint === "preflight") {
        const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
        const response = await GET(new Request("http://localhost"), params);
        expect(response.status).toBe(200);
        expect((await response.json()).errors).toEqual(["Host-assigned themes must exist in the draft's guild. Choose valid themes or switch to Random or Players pick."]);
      } else {
        const { PUT, POST } = await import("../app/api/drafts/[slug]/route");
        const response = entryPoint === "edit"
          ? await PUT(new Request("http://localhost", {
            method: "PUT", body: JSON.stringify({ config: { pickSeconds: 60 } }),
          }) as NextRequest, params)
          : await POST(new Request("http://localhost", { method: "POST" }), params);
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe("Host-assigned themes must exist in the draft's guild. Choose valid themes or switch to Random or Players pick.");
      }

      const row = db.prepare("select status, config_json from drafts").get() as { status: string; config_json: string };
      expect(row.status).toBe("pending");
      expect(JSON.parse(row.config_json).pickSeconds).toBe(45);
      expect(db.prepare("select count(*) as n from draft_player_cube").get()).toEqual({ n: 0 });
    }, 30000);

    it.each([true, false])("enforces uniqueThemes=%s for duplicate assignments", async (uniqueThemes) => {
      await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], {
        themeSelection: "host_assigned", themeAssignments: { "1": 1, "2": 1 }, uniqueThemes, extraDeckEnabled: false,
      });
      auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
      const params = { params: Promise.resolve({ slug: "theme-slug" }) };

      if (entryPoint === "preflight") {
        const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
        const response = await GET(new Request("http://localhost"), params);
        expect(response.status).toBe(200);
        const body = await response.json();
        if (uniqueThemes) expect(body.errors).toContainEqual(expect.stringMatching(/distinct.*uniqueThemes/i));
        else expect(body.errors).toEqual([]);
      } else {
        const { PUT, POST } = await import("../app/api/drafts/[slug]/route");
        const response = entryPoint === "edit"
          ? await PUT(new Request("http://localhost", {
            method: "PUT", body: JSON.stringify({ config: { pickSeconds: 60 } }),
          }) as NextRequest, params)
          : await POST(new Request("http://localhost", { method: "POST" }), params);
        expect(response.status).toBe(uniqueThemes ? 400 : 200);
        const body = await response.json();
        if (uniqueThemes) expect(body.error).toMatch(/distinct.*uniqueThemes/i);
        else if (entryPoint === "edit") expect(body.config).toMatchObject({ themeAssignments: { "1": 1, "2": 1 }, uniqueThemes: false });
        else {
          expect(body.status).toBe("active");
          const { getDb } = await import("@/lib/db");
          expect(getDb().prepare("select player_id, cube_id from draft_player_cube order by player_id").all())
            .toEqual([{ player_id: 1, cube_id: 1 }, { player_id: 2, cube_id: 1 }]);
        }
      }
    }, 30000);
  });

  it("rejects enabling uniqueThemes when the merged assignments contain duplicates", async () => {
    await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], {
      themeSelection: "host_assigned", themeAssignments: { "1": 1, "2": 1 }, uniqueThemes: false,
    });
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://localhost", {
      method: "PUT", body: JSON.stringify({ config: { uniqueThemes: true } }),
    }) as NextRequest, { params: Promise.resolve({ slug: "theme-slug" }) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/distinct.*uniqueThemes/i);
    const { getDb } = await import("@/lib/db");
    const row = getDb().prepare("select config_json from drafts").get() as { config_json: string };
    expect(JSON.parse(row.config_json).uniqueThemes).toBe(false);
  }, 30000);

  it("validates stored host assignments on a rename-only edit", async () => {
    await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], {
      themeSelection: "host_assigned", themeAssignments: { "1": 1, "2": 2 },
    });
    const { getDb } = await import("@/lib/db");
    getDb().prepare("delete from cubes where id = 2").run();
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://localhost", {
      method: "PUT", body: JSON.stringify({ name: "Renamed Night" }),
    }) as NextRequest, { params: Promise.resolve({ slug: "theme-slug" }) });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/exist.*draft.*guild/i);
    expect(getDb().prepare("select name from drafts").get()).toEqual({ name: "Theme Night" });
  }, 30000);

  it("still starts random selection after discarding a deleted allowed theme", async () => {
    await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }, { main: 42, extra: 0 }], {
      themeSelection: "random", extraDeckEnabled: false,
    });
    const { getDb } = await import("@/lib/db");
    getDb().prepare("delete from cubes where id = 3").run();
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { POST } = await import("../app/api/drafts/[slug]/route");
    const response = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ slug: "theme-slug" }) });

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("active");
    expect(getDb().prepare("select cube_id from draft_player_cube order by cube_id").all()).toEqual([{ cube_id: 1 }, { cube_id: 2 }]);
  }, 30000);

  it("shows a preflight error for a legacy draft with missing host assignments and returns a clear start error", async () => {
    const { dbPath } = await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], { themeSelection: "host_assigned", extraDeckEnabled: false });
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
    const preflight = await GET(new Request("http://localhost"), { params: Promise.resolve({ slug: "theme-slug" }) });
    expect(preflight.status).toBe(200);
    expect((await preflight.json()).errors).toContainEqual(expect.stringMatching(/assignment for every player/i));

    const { GET: getDraft, POST } = await import("../app/api/drafts/[slug]/route");
    const lobby = await getDraft(new Request("http://localhost"), { params: Promise.resolve({ slug: "theme-slug" }) });
    expect(lobby.status).toBe(200);
    expect((await lobby.json()).status).toBe("pending");
    const started = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ slug: "theme-slug" }) });
    expect(started.status).toBe(400);
    expect((await started.json()).error).toMatch(/choose random or players pick/i);

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);
    expect(db.prepare("select status from drafts").get()).toEqual({ status: "pending" });
    expect(db.prepare("select count(*) as n from draft_player_cube").get()).toEqual({ n: 0 });
    db.close();
  }, 30000);

  it("allows a legacy draft to switch back to random selection", async () => {
    await seedDraft([{ main: 42, extra: 0 }, { main: 42, extra: 0 }], { themeSelection: "host_assigned" });
    auth.mockResolvedValue({ user: { id: "u1", name: "P1" } });
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(new Request("http://localhost/api/drafts/theme-slug", {
      method: "PUT",
      body: JSON.stringify({ config: { themeSelection: "random" } }),
    }) as NextRequest, { params: Promise.resolve({ slug: "theme-slug" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).config.themeSelection).toBe("random");
  }, 30000);

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
});
