import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { createDraftService } from "@yugidraft/shared/services";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ announcer: { announce: vi.fn() }, broadcaster: { draft: vi.fn() } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const owner = "900000000000009001";
const host = "900000000000009002";
const member = "900000000000009003";
let seedDir: string;
let testDir: string;
const login = (id: string) => auth.mockResolvedValue({ user: { id: String(id), name: "Test member" } });
const request = (body?: object, method = "POST") => new Request("http://test", { method, ...(body ? { body: JSON.stringify(body) } : {}) });
const cubeContext = { params: Promise.resolve({ id: "1" }) };
const draftContext = { params: Promise.resolve({ slug: "private-cube-draft" }) };

describe("private cube boundaries with Discord session IDs", () => {
  beforeAll(() => {
    seedDir = mkdtempSync(join(tmpdir(), "private-cubes-seed-"));
    const db = new Database(join(seedDir, "seed.sqlite"));
    migrate(db);
    db.prepare("insert into cubes (id, guild_id, name, created_by_user_id) values (1, 'test-guild', 'Private pool', ?)").run(owner);
    db.prepare("insert into cubes (id, guild_id, name, created_by_user_id) values (2, 'test-guild', 'Host pool', ?)").run(host);
    const card = db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (?, ?, 'Normal Monster', 'normal', 'i', 'i', '[]', 't')");
    const pool = db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (1, ?, 'main', 1)");
    for (let id = 1; id <= 50; id++) { card.run(id, `Card ${id}`); pool.run(id); }
    db.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (1, 'test-guild', ?, 'Host'), (2, 'test-guild', ?, 'Member')").run(host, member);
    db.prepare("insert into drafts (id, guild_id, channel_id, name, created_by_user_id, status, web_slug, config_json) values (1, 'test-guild', 'test-channel', 'Existing draft', ?, 'pending', 'private-cube-draft', ?)")
      .run(host, JSON.stringify({ mode: "theme", allowedCubeIds: [1], themeSelection: "player_pick", uniqueThemes: false, cardsPerPlayer: 40, themePackSize: 3, extraDeckEnabled: false }));
    db.exec("insert into draft_players (draft_id, player_id) values (1, 1), (1, 2)");
    db.close();
  });
  beforeEach(() => {
    vi.resetModules();
    testDir = mkdtempSync(join(tmpdir(), "private-cubes-test-"));
    copyFileSync(join(seedDir, "seed.sqlite"), join(testDir, "test.sqlite"));
    vi.stubEnv("DATABASE_PATH", join(testDir, "test.sqlite"));
    vi.stubEnv("DISCORD_GUILD_ID", "test-guild");
    vi.stubEnv("THEME_DRAFTS", "1");
    auth.mockReset();
    const discord = mockDiscordAccess();
    discord.permissions = "32";
    login(host);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(testDir, { recursive: true, force: true }); });
  afterAll(() => rmSync(seedDir, { recursive: true, force: true }));

  it.each([host, "admin", owner])("lists only user %s's cubes, including admins", async id => {
    login(id);
    const { GET } = await import("../app/api/cubes/route");
    const result = await GET();
    expect(result.status).toBe(200);
    const expected = id === owner ? [1] : id === host ? [2] : [];
    expect((await result.json()).cubes.map((cube: { id: number }) => cube.id)).toEqual(expected);
  });

  it.each(["read", "rename", "delete", "export", "add", "remove", "setMaxCopies", "swapArtwork", "subtract", "import", "importYdk", "importList", "replaceMain", "seedArchetype"])("returns 404 for a foreign cube: %s", async operation => {
    const route = await import("../app/api/cubes/[id]/route");
    const cards = await import("../app/api/cubes/[id]/cards/route");
    const ydk = await import("../app/api/cubes/[id]/ydk/route");
    const result = operation === "read" ? await route.GET(request(undefined, "GET"), cubeContext)
      : operation === "rename" ? await route.PUT(request({ name: "Changed" }, "PUT"), cubeContext)
      : operation === "delete" ? await route.DELETE(request(undefined, "DELETE"), cubeContext)
      : operation === "export" ? await ydk.GET(request(undefined, "GET"), cubeContext)
      : await cards.POST(request({ op: operation, catalogCardId: 1, codes: [1] }), cubeContext);
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: "Cube not found" });
    const { getDb } = await import("@/lib/db");
    expect(getDb().prepare("select name, created_by_user_id from cubes where id = 1").get()).toEqual({ name: "Private pool", created_by_user_id: owner });
  });

  it("returns a page 404 before rendering another user's cube", async () => {
    const { default: page } = await import("../app/(app)/cubes/[id]/page");
    await expect(page(cubeContext)).rejects.toThrow("NEXT_NOT_FOUND");
    login(owner);
    await expect(page(cubeContext)).resolves.toBeDefined();
  });

  it.each(["theme", "booster-source"])("rejects foreign cube references at draft creation: %s", async source => {
    const { POST } = await import("../app/api/drafts/route");
    const config = source === "theme" ? { mode: "theme", allowedCubeIds: [1] }
      : { customCardIds: [1], poolSource: { cubeId: 1 } };
    const result = await POST(request({ name: "New draft", config }) as any);
    expect(result.status).toBe(404);
    const { getDb } = await import("@/lib/db");
    expect(getDb().prepare("select count(*) n from drafts").get()).toEqual({ n: 1 });
  });

  it("rejects attaching a foreign cube even when it is already attached", async () => {
    const { POST } = await import("../app/api/drafts/[slug]/cubes/route");
    expect((await POST(request({ kind: "existing", cubeId: 1 }), draftContext)).status).toBe(404);
  });

  it("rejects adding a foreign cube through draft config updates", async () => {
    const { getDb } = await import("@/lib/db");
    getDb().prepare("update drafts set config_json = ? where id = 1").run(JSON.stringify({ mode: "theme", allowedCubeIds: [] }));
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    expect((await PUT(request({ config: { allowedCubeIds: [1] } }, "PUT") as any, draftContext)).status).toBe(404);
  });

  it.each(["same-guild", "other-guild"])("rejects replacing a booster pool source with a foreign %s cube", async guild => {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    db.prepare("update drafts set config_json = ? where id = 1").run(JSON.stringify({ customCardIds: [1], poolSource: { cubeId: 2 }, cardsPerPlayer: 40 }));
    if (guild === "other-guild") db.exec("update cubes set guild_id = 'other-guild' where id = 1");
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    expect((await PUT(request({ config: { poolSource: { cubeId: 1 } } }, "PUT") as any, draftContext)).status).toBe(404);
  });

  it("does not expose theme cube details to a pending-lobby visitor", async () => {
    const { getDb } = await import("@/lib/db");
    login("outsider");
    const preflight = await import("../app/api/drafts/[slug]/preflight/route");
    expect((await preflight.GET(request(undefined, "GET"), draftContext)).status).toBe(404);
    const pool = await import("../app/api/drafts/[slug]/pool/route");
    expect((await pool.GET(request(undefined, "GET"), draftContext)).status).toBe(404);
    const draft = await import("../app/api/drafts/[slug]/route");
    const result = await draft.GET(request(undefined, "GET") as any, draftContext);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.allowedCubes).toBeUndefined();
    expect(body.config.allowedCubeIds).toBeUndefined();
    expect(JSON.stringify(body.lobby)).not.toContain("Cube 1:");
    const preview = await import("../app/api/drafts/[slug]/cubes/[id]/route");
    expect((await preview.GET(request(undefined, "GET"), { params: Promise.resolve({ slug: "private-cube-draft", id: "1" }) })).status).toBe(404);
  });

  it("shows the booster draft pool to a pending-lobby visitor while hiding its source cube", async () => {
    const { getDb } = await import("@/lib/db");
    const config = {
      mode: "booster", packSize: 8, packsPerPlayer: 5, cardsPerPlayer: 40,
      poolSource: { cubeId: 1, cubeName: "Private pool" }, customCardIds: [1, 2], cubeCardIds: [1, 2],
      customExtraCardIds: [3], setNames: ["Draft set"], includeNames: ["Card 1"], excludeNames: ["Card 50"],
    };
    getDb().prepare("update drafts set config_json = ? where id = 1").run(JSON.stringify(config));
    login("outsider");
    const draft = await import("../app/api/drafts/[slug]/route");
    const body = await (await draft.GET(request(undefined, "GET") as any, draftContext)).json();
    expect(body.config).not.toHaveProperty("poolSource");
    expect(body.config).toMatchObject(Object.fromEntries(Object.entries(config).filter(([key]) => key !== "poolSource")));
    const pool = await import("../app/api/drafts/[slug]/pool/route");
    const response = await pool.GET(request(undefined, "GET"), draftContext);
    expect(response.status).toBe(200);
    expect((await response.json()).cards.map((card: { id: number }) => card.id)).toEqual([1, 2]);
    const preflight = await import("../app/api/drafts/[slug]/preflight/route");
    expect((await preflight.GET(request(undefined, "GET"), draftContext)).status).toBe(200);
    login(member);
    expect((await pool.GET(request(undefined, "GET"), draftContext)).status).toBe(200);
  });

  it.each(["pending", "active", "completed", "cancelled"])("does not preview a booster source cube in a %s draft", async status => {
    const { getDb } = await import("@/lib/db");
    getDb().prepare("update drafts set status = ?, config_json = ? where id = 1").run(status, JSON.stringify({ mode: "booster", poolSource: { cubeId: 1 }, allowedCubeIds: [1] }));
    const { GET } = await import("../app/api/drafts/[slug]/cubes/[id]/route");
    const context = { params: Promise.resolve({ slug: "private-cube-draft", id: "1" }) };
    for (const user of [host, member]) {
      login(user);
      expect((await GET(request(undefined, "GET"), context)).status).toBe(404);
    }
  });

  it.each([
    { label: "blank", source: { kind: "blank" } },
    { label: "pool", source: { kind: "pool", cards: [{ id: 1, copies: 1 }] } },
    { label: "list", source: { kind: "list", importText: "Card 1" } },
    { label: "config", source: { config: { customCardIds: [1] } } },
  ])("allows two owners to create the same name from $label", async ({ source }) => {
    const { POST, GET } = await import("../app/api/cubes/route");
    const name = "Private pool";
    const result = await POST(request({ ...source, name }));
    expect(result.status).toBe(201);
    const cube = (await result.json()).cube;
    expect(cube).toMatchObject({ name, createdByUserId: host });
    expect(cube.id).not.toBe(1);
    expect((await (await GET()).json()).cubes.map((row: { id: number }) => row.id)).toContain(cube.id);
    expect((await POST(request({ ...source, name }))).status).toBe(409);
    login(owner);
    expect((await (await GET()).json()).cubes.map((row: { id: number }) => row.id)).toEqual([1]);
  });

  it("does not reveal an unattached foreign cube through a detach request", async () => {
    const { getDb } = await import("@/lib/db");
    getDb().prepare("update drafts set config_json = ? where id = 1").run(JSON.stringify({ mode: "theme", allowedCubeIds: [] }));
    const { DELETE } = await import("../app/api/drafts/[slug]/cubes/route");
    expect((await DELETE(request({ cubeId: 1 }, "DELETE"), draftContext)).status).toBe(404);
  });

  it("hides pool diagnostics in an idempotent leave response for an open-lobby outsider", async () => {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    db.exec("update drafts set lobby_start_error = 'Cube 1: private data' where id = 1");
    db.prepare("insert into draft_player_cube (draft_id, player_id, cube_id) values (1, 1, 1)").run();
    login("outsider");
    const { DELETE } = await import("../app/api/drafts/[slug]/join/route");
    const result = await DELETE(request(undefined, "DELETE"), draftContext);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.players.every((player: { cubeId: number | null }) => player.cubeId === null)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Cube 1:");
  });

  it("rejects copying a foreign extra pool into a new cube", async () => {
    const { POST } = await import("../app/api/cubes/route");
    expect((await POST(request({ kind: "pool", name: "Copy", cards: [{ id: 1, copies: 1 }], copyExtraFromCubeId: 1 }))).status).toBe(404);
  });

  it("hides cubes with an unknown owner without deleting their data", async () => {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    db.pragma("foreign_keys = OFF");
    db.exec("update cubes set created_by_user_id = 999999 where id = 2");
    db.pragma("foreign_keys = ON");
    const { GET } = await import("../app/api/cubes/route");
    expect((await (await GET()).json()).cubes).toEqual([]);
    expect(db.prepare("select count(*) n from cubes").get()).toEqual({ n: 2 });
  });

  it("keeps an unknown-owner cube available through its existing draft attachment only", async () => {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    db.pragma("foreign_keys = OFF");
    db.exec("update cubes set created_by_user_id = 999999 where id = 1");
    db.pragma("foreign_keys = ON");
    login(owner);
    const library = await import("../app/api/cubes/[id]/route");
    expect((await library.GET(request(undefined, "GET"), cubeContext)).status).toBe(404);
    login(member);
    const preview = await import("../app/api/drafts/[slug]/cubes/[id]/route");
    expect((await preview.GET(request(undefined, "GET"), { params: Promise.resolve({ slug: "private-cube-draft", id: "1" }) })).status).toBe(200);
    expect(db.prepare("select count(*) n from cube_cards where cube_id = 1").get()).toEqual({ n: 50 });
  });

  it.each(["pending", "active"])("allows only draft members to preview attached foreign cubes in a %s draft", async status => {
    const { getDb } = await import("@/lib/db");
    getDb().prepare("update drafts set status = ? where id = 1").run(status);
    const { GET } = await import("../app/api/drafts/[slug]/cubes/[id]/route");
    const context = { params: Promise.resolve({ slug: "private-cube-draft", id: "1" }) };
    login(member);
    const result = await GET(request(undefined, "GET"), context);
    expect(result.status).toBe(200);
    expect((await result.json()).pools.main).toHaveLength(50);
    expect((await GET(request(undefined, "GET"), { params: Promise.resolve({ slug: "private-cube-draft", id: "2" }) })).status).toBe(404);
    for (const outsider of ["outsider", owner]) {
      login(outsider);
      expect((await GET(request(undefined, "GET"), context)).status).toBe(404);
    }
  });

  it("keeps an attached foreign cube usable for config edits, claims, preflight, dealing and picks", async () => {
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    expect((await PUT(request({ config: { pickSeconds: 60, allowedCubeIds: [1] } }, "PUT") as any, draftContext)).status).toBe(200);
    const claims = await import("../app/api/drafts/[slug]/claim-cube/route");
    expect((await claims.POST(request({ cubeId: 1 }), draftContext)).status).toBe(200);
    login(member);
    expect((await claims.POST(request({ cubeId: 1 }), draftContext)).status).toBe(200);
    const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
    expect(await (await GET(request(undefined, "GET"), draftContext)).json()).toMatchObject({ errors: [] });
    const { getDb } = await import("@/lib/db");
    const drafts = createDraftService(getDb());
    drafts.start(1);
    const option = drafts.currentPackOptions(1, 2)[0];
    const { POST } = await import("../app/api/drafts/[slug]/pick/route");
    expect((await POST(request({ cardId: option.id }) as any, draftContext)).status).toBe(200);
    expect(getDb().prepare("select count(*) n from draft_picks where draft_id = 1 and player_id = 2").get()).toEqual({ n: 1 });
  });
});
