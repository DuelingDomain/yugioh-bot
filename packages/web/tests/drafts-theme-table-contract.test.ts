import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftConfig } from "@yugidraft/shared/types";

const auth = vi.fn();
const broadcast = vi.fn();
const invalidate = vi.fn();
const connections: Database.Database[] = [];
const directories: string[] = [];

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ broadcaster: { draft: broadcast } }));
// T03 is developed in parallel. Keep the DB behavior real at the route boundary.
vi.mock("@yugidraft/shared/services", async (importOriginal) => ({
  ...await importOriginal<typeof import("@yugidraft/shared/services")>(),
  createDraftLobbyService: (db: Database.Database) => ({
    invalidate: (draftId: number, options: { clearReady: true | number[] }) => invalidate(db, draftId, options),
  }),
}));

const context = { params: Promise.resolve({ slug: "table" }) };
const request = (method: string, body?: unknown) => new Request("http://localhost/api/drafts/table", {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function seed(overrides: Partial<DraftConfig> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "theme-table-"));
  directories.push(directory);
  process.env.DATABASE_PATH = join(directory, "table.sqlite");
  process.env.DISCORD_GUILD_ID = "guild";
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  connections.push(db);
  db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild', 'host', 'Host'), ('guild', 'guest', 'Guest'), ('guild', 'bot_player_dev_table_1', 'Bot')").run();
  db.prepare("insert into cubes (guild_id, name, created_by_user_id) values ('guild', 'First', 'host'), ('guild', 'Second', 'host'), ('other', 'Foreign', 'other')").run();
  const config: DraftConfig = {
    mode: "theme", themeSelection: "player_pick", uniqueThemes: true,
    allowedCubeIds: [1, 2], cardsPerPlayer: 40, themePackSize: 3,
    extraDeckEnabled: false, pickSeconds: 45, ...overrides,
  };
  db.prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug) values ('guild', 'channel', 'Table', 'pending', 'host', ?, 'table')").run(JSON.stringify(config));
  db.prepare("insert into draft_players (draft_id, player_id, ready_at, ready_setup_hash) values (1, 1, 'ready', 'hash'), (1, 2, 'ready', 'hash')").run();
  db.prepare("update drafts set lobby_start_at = 'deadline', lobby_start_kind = 'manual', lobby_start_token = 'token', lobby_start_revision = 0, lobby_start_setup_hash = 'hash', lobby_start_force = 1").run();
  return db;
}

function config(db: Database.Database): DraftConfig {
  return JSON.parse((db.prepare("select config_json from drafts where id = 1").get() as { config_json: string }).config_json);
}

function state(db: Database.Database) {
  return {
    draft: db.prepare("select * from drafts where id = 1").get(),
    players: db.prepare("select * from draft_players order by player_id").all(),
    claims: db.prepare("select * from draft_player_cube order by player_id").all(),
  };
}

function changeWhileParsing(body: unknown, change: () => void) {
  const req = request("POST", body);
  vi.spyOn(req, "json").mockImplementation(async () => { change(); return body; });
  return req;
}

function seedGate() {
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { requested = resolve; });
  vi.stubGlobal("fetch", vi.fn(async () => {
    requested();
    await gate;
    return new Response(JSON.stringify({ data: [{
      id: 100, name: "Seeded", type: "Normal Monster", frameType: "normal", desc: "",
      card_images: [{ image_url: "image", image_url_small: "small" }],
    }] }));
  }));
  return { release, started };
}

beforeEach(() => {
  vi.resetModules();
  auth.mockReset().mockResolvedValue({ user: { id: "host" } });
  broadcast.mockReset().mockResolvedValue(undefined);
  invalidate.mockReset().mockImplementation((db: Database.Database, draftId: number, options: { clearReady: true | number[] }) => {
    expect(db.inTransaction).toBe(true);
    const ids = options.clearReady === true
      ? (db.prepare("select player_id from draft_players where draft_id = ?").all(draftId) as { player_id: number }[]).map((p) => p.player_id)
      : options.clearReady;
    for (const id of ids) db.prepare("update draft_players set ready_at = null, ready_setup_hash = null where draft_id = ? and player_id = ?").run(draftId, id);
    db.prepare(`update drafts set lobby_revision = lobby_revision + 1,
      lobby_start_at = null, lobby_start_kind = null, lobby_start_token = null,
      lobby_start_revision = null, lobby_start_setup_hash = null, lobby_start_force = 0
      where id = ?`).run(draftId);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const db of connections.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
  delete process.env.DISCORD_GUILD_ID;
});

describe("self claim and release", () => {
  it("claims only the viewer's seat and clears only that seat's Ready", async () => {
    const db = await seed();
    const { POST } = await import("../app/api/drafts/[slug]/claim-cube/route");
    const response = await POST(request("POST", { cubeId: 1, playerId: 2 }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cubeId: 1 });
    expect(db.prepare("select player_id, cube_id from draft_player_cube").all()).toEqual([{ player_id: 1, cube_id: 1 }]);
    expect(db.prepare("select player_id, ready_at, ready_setup_hash from draft_players order by player_id").all())
      .toEqual([{ player_id: 1, ready_at: null, ready_setup_hash: null }, { player_id: 2, ready_at: "ready", ready_setup_hash: "hash" }]);
    expect(db.prepare("select lobby_revision, lobby_start_token, lobby_start_at from drafts").get())
      .toEqual({ lobby_revision: 1, lobby_start_token: null, lobby_start_at: null });
    expect(broadcast).toHaveBeenCalledWith({ kind: "seats", slug: "table" });
  });

  it("serializes competing unique claims using independent DB connections", async () => {
    const db = await seed();
    const other = new Database(process.env.DATABASE_PATH!);
    other.pragma("busy_timeout = 0");
    connections.push(other);
    const prepare = db.prepare.bind(db);
    let locked = false;
    vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      const statement = prepare(sql);
      if (/insert into draft_player_cube/i.test(sql)) {
        const run = statement.run.bind(statement);
        vi.spyOn(statement, "run").mockImplementation((...params: unknown[]) => {
          try {
            other.transaction(() => {
              other.prepare("insert into draft_player_cube (draft_id, player_id, cube_id) values (1, 2, 1)").run();
            }).immediate();
          } catch (error) {
            if ((error as { code?: string }).code !== "SQLITE_BUSY") throw error;
            locked = true;
          }
          return run(...params);
        });
      }
      return statement;
    }) as typeof db.prepare);
    const { POST } = await import("../app/api/drafts/[slug]/claim-cube/route");
    const first = await POST(request("POST", { cubeId: 1 }), context);
    vi.restoreAllMocks();
    auth.mockResolvedValue({ user: { id: "guest" } });
    const second = await POST(request("POST", { cubeId: 1 }), context);
    expect(locked).toBe(true);
    expect([first.status, second.status]).toEqual([200, 409]);
    expect(db.prepare("select player_id from draft_player_cube").all()).toEqual([{ player_id: 1 }]);
  });

  it("allows shared claims when uniqueness is disabled", async () => {
    const db = await seed({ uniqueThemes: false });
    const { POST } = await import("../app/api/drafts/[slug]/claim-cube/route");
    expect((await POST(request("POST", { cubeId: 1 }), context)).status).toBe(200);
    auth.mockResolvedValue({ user: { id: "guest" } });
    expect((await POST(request("POST", { cubeId: 1 }), context)).status).toBe(200);
    expect(db.prepare("select count(*) as count from draft_player_cube").get()).toEqual({ count: 2 });
  });

  it("releases only self, ignoring a supplied target player", async () => {
    const db = await seed();
    db.prepare("insert into draft_player_cube (draft_id, player_id, cube_id) values (1, 1, 1), (1, 2, 2)").run();
    const { DELETE } = await import("../app/api/drafts/[slug]/claim-cube/route");
    expect(typeof DELETE).toBe("function");
    const response = await DELETE(request("DELETE", { playerId: 2 }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cubeId: null });
    expect(db.prepare("select player_id, cube_id from draft_player_cube").all()).toEqual([{ player_id: 2, cube_id: 2 }]);
    expect(db.prepare("select ready_at from draft_players where player_id = 2").get()).toEqual({ ready_at: "ready" });
    expect(db.prepare("select lobby_revision from drafts").get()).toEqual({ lobby_revision: 1 });
  });

  it("keeps Ready and revision unchanged when retrying the same claim or an empty release", async () => {
    const db = await seed();
    db.prepare("insert into draft_player_cube (draft_id, player_id, cube_id) values (1, 1, 1)").run();
    const { POST, DELETE } = await import("../app/api/drafts/[slug]/claim-cube/route");
    expect((await POST(request("POST", { cubeId: 1 }), context)).status).toBe(200);
    expect(invalidate).not.toHaveBeenCalled();
    auth.mockResolvedValue({ user: { id: "guest" } });
    expect((await DELETE(request("DELETE"), context)).status).toBe(200);
    expect(invalidate).not.toHaveBeenCalled();
    expect(db.prepare("select lobby_revision from drafts").get()).toEqual({ lobby_revision: 0 });
  });

  it.each([
    ["start", "update drafts set status = 'active'", 409],
    ["leave", "delete from draft_players where player_id = 1", 403],
    ["detach", "update drafts set config_json = json_set(config_json, '$.allowedCubeIds', json('[2]'))", 400],
    ["move cube", "update cubes set guild_id = 'other' where id = 1", 404],
    ["change selection", "update drafts set config_json = json_set(config_json, '$.themeSelection', 'random')", 400],
  ])("rechecks %s after reading the claim body", async (_name, sql, status) => {
    const db = await seed();
    const { POST } = await import("../app/api/drafts/[slug]/claim-cube/route");
    const response = await POST(changeWhileParsing({ cubeId: 1 }, () => db.exec(sql as string)), context);
    expect(response.status).toBe(status);
    expect(db.prepare("select * from draft_player_cube").all()).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("rolls back a claim when invalidation fails", async () => {
    const db = await seed();
    const before = state(db);
    invalidate.mockImplementationOnce(() => { throw new Error("invalidation failed"); });
    const { POST } = await import("../app/api/drafts/[slug]/claim-cube/route");
    await expect(POST(request("POST", { cubeId: 1 }), context)).rejects.toThrow("invalidation failed");
    expect(state(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rolls back release when invalidation fails", async () => {
    const db = await seed();
    db.prepare("insert into draft_player_cube (draft_id, player_id, cube_id) values (1, 1, 1)").run();
    const before = state(db);
    invalidate.mockImplementationOnce(() => { throw new Error("invalidation failed"); });
    const { DELETE } = await import("../app/api/drafts/[slug]/claim-cube/route");
    await expect(DELETE(request("DELETE"), context)).rejects.toThrow("invalidation failed");
    expect(state(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it.each(["random", "host_assigned"] as const)("disables claim and release for %s selection", async (themeSelection) => {
    const db = await seed({ themeSelection });
    const before = state(db);
    const { POST, DELETE } = await import("../app/api/drafts/[slug]/claim-cube/route");
    expect((await POST(request("POST", { cubeId: 1 }), context)).status).toBe(400);
    expect((await DELETE(request("DELETE"), context)).status).toBe(400);
    expect(state(db)).toEqual(before);
  });
});

describe("attach/detach", () => {
  it("detaches claims and all matching host assignments together, keeping the cube in the library", async () => {
    const db = await seed({ themeSelection: "host_assigned", themeAssignments: { "1": 1, "2": 2, "99": 1 } });
    db.prepare("insert into draft_player_cube (draft_id, player_id, cube_id) values (1, 1, 1), (1, 2, 2)").run();
    const { DELETE } = await import("../app/api/drafts/[slug]/cubes/route");
    const response = await DELETE(request("DELETE", { cubeId: 1 }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, allowedCubeIds: [2] });
    expect(config(db).themeAssignments).toEqual({ "2": 2 });
    expect(db.prepare("select player_id, cube_id from draft_player_cube").all()).toEqual([{ player_id: 2, cube_id: 2 }]);
    expect(db.prepare("select id from cubes where id = 1").get()).toEqual({ id: 1 });
    expect(db.prepare("select ready_at from draft_players").all()).toEqual([{ ready_at: null }, { ready_at: null }]);
    expect(db.prepare("select lobby_revision, lobby_start_token from drafts").get()).toEqual({ lobby_revision: 1, lobby_start_token: null });
  });

  it("rolls back config and claim cleanup when invalidation fails", async () => {
    const db = await seed({ themeSelection: "host_assigned", themeAssignments: { "1": 1, "2": 2 } });
    db.prepare("insert into draft_player_cube (draft_id, player_id, cube_id) values (1, 1, 1)").run();
    const before = state(db);
    invalidate.mockImplementationOnce(() => { throw new Error("invalidation failed"); });
    const { DELETE } = await import("../app/api/drafts/[slug]/cubes/route");
    await expect(DELETE(request("DELETE", { cubeId: 1 }), context)).rejects.toThrow("invalidation failed");
    expect(state(db)).toEqual(before);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rolls back blank creation and attachment when invalidation fails", async () => {
    const db = await seed();
    const before = state(db);
    invalidate.mockImplementationOnce(() => { throw new Error("invalidation failed"); });
    const { POST } = await import("../app/api/drafts/[slug]/cubes/route");
    await expect(POST(request("POST", { kind: "blank", name: "Rollback" }), context)).rejects.toThrow("invalidation failed");
    expect(state(db)).toEqual(before);
    expect(db.prepare("select count(*) as count from cubes").get()).toEqual({ count: 3 });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("can detach a deleted attachment but rejects a missing unrelated cube", async () => {
    const db = await seed();
    db.prepare("delete from cubes where id = 1").run();
    const { DELETE } = await import("../app/api/drafts/[slug]/cubes/route");
    expect((await DELETE(request("DELETE", { cubeId: 1 }), context)).status).toBe(200);
    expect(config(db).allowedCubeIds).toEqual([2]);
    const before = state(db);
    expect((await DELETE(request("DELETE", { cubeId: 99 }), context)).status).toBe(404);
    expect(state(db)).toEqual(before);
  });

  it("attaches an existing cube with distinct counts and clears Ready without releasing sticky Hold", async () => {
    const db = await seed({ allowedCubeIds: [1] });
    db.prepare("update drafts set lobby_auto_start = 1, lobby_auto_held = 1").run();
    db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (100, 'Main', 'Normal Monster', 'normal', 'i', 'i', '[]', 't'), (101, 'Extra', 'Fusion Monster', 'fusion', 'i', 'i', '[]', 't')").run();
    db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (2, 100, 'main', 10), (2, 101, 'extra', 5)").run();
    const { POST } = await import("../app/api/drafts/[slug]/cubes/route");
    const response = await POST(request("POST", { kind: "existing", cubeId: 2 }), context);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ cube: { id: 2, mainCount: 1, extraCount: 1 }, allowedCubeIds: [1, 2] });
    expect(db.prepare("select ready_at from draft_players").all()).toEqual([{ ready_at: null }, { ready_at: null }]);
    expect(db.prepare("select lobby_auto_start, lobby_auto_held, lobby_revision, lobby_start_token from drafts").get())
      .toEqual({ lobby_auto_start: 1, lobby_auto_held: 1, lobby_revision: 1, lobby_start_token: null });
  });

  it.each(["start", "mode", "delete"])("keeps a seeded cube saved when concurrent %s prevents attachment", async (change) => {
    const db = await seed();
    const gate = seedGate();
    const { POST } = await import("../app/api/drafts/[slug]/cubes/route");
    const pending = POST(request("POST", { kind: "archetype", archetype: "Seeded" }), context);
    await gate.started;
    if (change === "start") db.prepare("update drafts set status = 'active' where id = 1").run();
    if (change === "mode") db.prepare("update drafts set config_json = json_set(config_json, '$.mode', 'booster') where id = 1").run();
    if (change === "delete") {
      db.prepare("delete from draft_players where draft_id = 1").run();
      db.prepare("delete from drafts where id = 1").run();
    }
    gate.release();
    const response = await pending;
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "CUBE_ATTACH_CONFLICT", savedCubeId: 4 });
    expect(body.error).toMatch(/saved.*library/i);
    expect(db.prepare("select name from cubes where id = ?").get(body.savedCubeId)).toEqual({ name: "Seeded" });
    if (change !== "delete") expect(config(db).allowedCubeIds).toEqual([1, 2]);
    expect(invalidate).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("preserves concurrent config edits and attachment changes during seeding", async () => {
    const db = await seed();
    const gate = seedGate();
    const { POST, DELETE } = await import("../app/api/drafts/[slug]/cubes/route");
    const pending = POST(request("POST", { kind: "archetype", archetype: "Seeded" }), context);
    await gate.started;
    db.prepare("update drafts set config_json = json_set(config_json, '$.pickSeconds', 60)").run();
    expect((await DELETE(request("DELETE", { cubeId: 1 }), context)).status).toBe(200);
    const other = await POST(request("POST", { kind: "blank", name: "Other" }), context);
    expect(other.status).toBe(201);
    gate.release();
    const response = await pending;
    expect(response.status).toBe(201);
    expect(config(db)).toMatchObject({ pickSeconds: 60, allowedCubeIds: [2, 4, 5] });
    expect(db.prepare("select lobby_revision from drafts").get()).toEqual({ lobby_revision: 3 });
  });

  it.each(["POST", "DELETE"])("rechecks pending status during %s body parsing", async (method) => {
    const db = await seed();
    const routes = await import("../app/api/drafts/[slug]/cubes/route");
    const response = await routes[method as "POST" | "DELETE"](changeWhileParsing(
      method === "POST" ? { kind: "blank", name: "Late" } : { cubeId: 1 },
      () => db.prepare("update drafts set status = 'active'").run(),
    ), context);
    expect(response.status).toBe(409);
    expect(config(db).allowedCubeIds).toEqual([1, 2]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each(["POST", "DELETE"])("rejects cube edits on a booster draft via %s", async (method) => {
    const db = await seed({ mode: "booster" });
    const routes = await import("../app/api/drafts/[slug]/cubes/route");
    const response = await routes[method as "POST" | "DELETE"](request(method, method === "POST" ? { kind: "blank", name: "Wrong" } : { cubeId: 1 }), context);
    expect(response.status).toBe(400);
    expect(config(db).allowedCubeIds).toEqual([1, 2]);
    expect(db.prepare("select count(*) as count from cubes").get()).toEqual({ count: 3 });
  });

  it("rejects an existing cube that belongs to another guild", async () => {
    await seed();
    const { POST } = await import("../app/api/drafts/[slug]/cubes/route");
    expect((await POST(request("POST", { kind: "existing", cubeId: 3 }), context)).status).toBe(404);
  });
});

describe("body, role and guild boundaries", () => {
  it.each([null, [], "invalid", { cubeId: 0 }, { cubeId: 1.5 }].map((body) => [body]))("rejects malformed claim body %j", async (body) => {
    await seed();
    const { POST } = await import("../app/api/drafts/[slug]/claim-cube/route");
    expect((await POST(request("POST", body), context)).status).toBe(400);
  });

  it.each([null, [], { kind: "bogus", name: "Bad" }, { kind: "blank", name: 123 }, { kind: "archetype", archetype: [] }].map((body) => [body]))("rejects malformed attach body %j", async (body) => {
    const db = await seed();
    const { POST } = await import("../app/api/drafts/[slug]/cubes/route");
    expect((await POST(request("POST", body), context)).status).toBe(400);
    expect(db.prepare("select count(*) as count from cubes").get()).toEqual({ count: 3 });
  });

  it.each(["claim", "release", "attach", "detach"])("enforces session, draft guild and role for %s", async (operation) => {
    const db = await seed();
    const claims = await import("../app/api/drafts/[slug]/claim-cube/route");
    const cubes = await import("../app/api/drafts/[slug]/cubes/route");
    const route = operation === "claim" ? claims.POST : operation === "release" ? claims.DELETE : operation === "attach" ? cubes.POST : cubes.DELETE;
    const body = operation === "attach" ? { kind: "blank", name: "Denied" } : { cubeId: 1 };
    auth.mockResolvedValue(null);
    expect((await route(request("POST", body), context)).status).toBe(401);
    auth.mockResolvedValue({ user: { id: "stranger" } });
    expect((await route(request("POST", body), context)).status).toBe(403);
    auth.mockResolvedValue({ user: { id: "host" } });
    db.prepare("update drafts set guild_id = 'other' where id = 1").run();
    expect((await route(request("POST", body), context)).status).toBe(404);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("whole-map host assignments and private preflight", () => {
  it("accepts a complete assignment map including a joined bot", async () => {
    const db = await seed({ themeSelection: "host_assigned", uniqueThemes: false });
    db.prepare("insert into draft_players (draft_id, player_id) values (1, 3)").run();
    const { hostThemeAssignmentError } = await import("@/lib/theme-draft-validation");
    expect(hostThemeAssignmentError(db, "guild", { ...config(db), themeAssignments: { "1": 1, "2": 2, "3": 1 } }, [1, 2, 3])).toBeUndefined();
    expect(hostThemeAssignmentError(db, "guild", { ...config(db), themeAssignments: { "1": 1, "2": 2 } }, [1, 2, 3])).toMatch(/every player/i);
  });

  it.each([{}, { "1": 1 }, { "1": 1, "2": 3 }, { "1": 1, "2": 1 }, { "1": 1, "2": "2" }, [0, 1, 2]].map((assignments) => [assignments]))("rejects invalid host map %j", async (assignments) => {
    const db = await seed({ themeSelection: "host_assigned" });
    const { hostThemeAssignmentError } = await import("@/lib/theme-draft-validation");
    expect(hostThemeAssignmentError(db, "guild", { ...config(db), themeAssignments: assignments as Record<string, number> }, [1, 2])).toBeTruthy();
  });

  it("keeps host-assigned preflight private for other joined viewers", async () => {
    await seed({ themeSelection: "host_assigned", themeAssignments: { "1": 1 } });
    const { GET } = await import("../app/api/drafts/[slug]/preflight/route");
    auth.mockResolvedValue({ user: { id: "guest" } });
    expect(await (await GET(request("GET"), context)).json()).toEqual({ errors: [], warnings: [] });
    auth.mockResolvedValue({ user: { id: "host" } });
    expect((await (await GET(request("GET"), context)).json()).errors).toEqual([expect.stringMatching(/every player/i)]);
  });
});
