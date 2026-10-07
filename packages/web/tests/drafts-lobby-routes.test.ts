import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import * as sharedServices from "@yugidraft/shared/services";
import { createDraftService, isTestBotDiscordId } from "@yugidraft/shared/services";
import type { DraftLobbyResponse, DraftLobbyTickResult } from "@yugidraft/shared/types";
import type { BrowserDraftLobbyService } from "@/lib/draft-lobby-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adapter fixture for T04 only, while T03 is developed in another worktree.
 * The real draft engine validates/deals; only lobby read/schedule/invalidation
 * are substituted. It does not verify the shared state machine or its races.
 * This owned file also supplies fixtures to the owned legacy route suites.
 */
export function createTestDraftLobbyApi(db: Database.Database): BrowserDraftLobbyService {
  const drafts = createDraftService(db);
  const read = (id: number, userId: string): DraftLobbyResponse => {
    const draft = drafts.findById(id);
    const row = db.prepare("select * from drafts where id = ?").get(id) as any;
    const players = (db.prepare(`select p.id, p.discord_user_id, p.display_name, dp.*,
      c.cube_id from draft_players dp join players p on p.id = dp.player_id
      left join draft_player_cube c on c.draft_id = dp.draft_id and c.player_id = dp.player_id
      where dp.draft_id = ? order by dp.joined_at, dp.rowid`).all(id) as any[]).map((p) => ({
      playerId: p.id, displayName: p.display_name, seatIndex: p.seat_index ?? undefined,
      pickCount: p.pick_count, joinedAt: p.joined_at,
      isHost: p.discord_user_id === draft.createdByUserId, isYou: p.discord_user_id === userId,
      isBot: isTestBotDiscordId(p.discord_user_id), ready: true, readyAt: p.ready_at,
      cubeId: draft.config.mode !== "theme" ? null
        : draft.config.themeSelection === "random" ? null
        : draft.config.themeSelection === "host_assigned"
          ? userId === draft.createdByUserId ? draft.config.themeAssignments?.[String(p.id)] ?? null : null
          : p.cube_id ?? null,
    }));
    return { players, lobby: {
      revision: row.lobby_revision, serverNow: new Date().toISOString(),
      targetSeats: draft.config.lobbySeats ?? null, joined: players.length, ready: players.length,
      allReady: true, autoStart: { enabled: !!row.lobby_auto_start, held: !!row.lobby_auto_held, eligible: false },
      start: row.lobby_start_token ? { token: row.lobby_start_token, kind: row.lobby_start_kind, startsAt: row.lobby_start_at } : null,
      errors: [], warnings: [], lastStartError: row.lobby_start_error,
    } };
  };
  return {
    read,
    invalidate(id) {
      db.prepare(`update drafts set lobby_revision = lobby_revision + 1,
        lobby_start_token = null, lobby_start_at = null, lobby_start_kind = null where id = ?`).run(id);
    },
    scheduleStart(id, userId, { revision }) {
      const current = read(id, userId);
      if (revision !== current.lobby.revision) throw Object.assign(new Error("Lobby changed"), { code: "STALE_LOBBY" });
      if (current.lobby.start) return current;
      // Validate through the existing engine without committing any cards.
      const validated = {};
      try { db.transaction(() => { drafts.start(id); throw validated; })(); }
      catch (error) {
        if (error !== validated) throw Object.assign(error as Error, { code: "PREFLIGHT_FAILED" });
      }
      db.prepare(`update drafts set lobby_start_token = ?, lobby_start_kind = 'manual', lobby_start_at = ? where id = ?`)
        .run(`test-${id}`, new Date(Date.now() + 5000).toISOString(), id);
      return read(id, userId);
    },
    tick(now, draftId) {
      const started: DraftLobbyTickResult["started"] = [];
      const rows = db.prepare("select id, web_slug from drafts where status = 'pending' and lobby_start_at <= ?")
        .all(new Date(now).toISOString()) as Array<{ id: number; web_slug: string }>;
      for (const row of rows) {
        if (draftId !== undefined && row.id !== draftId) continue;
        db.transaction(() => {
          // Invoke the unscheduled engine kernel; the fixture owns its deadline.
          db.prepare(`update drafts set lobby_start_token = null, lobby_start_at = null, lobby_start_kind = null,
            lobby_start_revision = null, lobby_start_setup_hash = null, lobby_start_force = 0 where id = ?`).run(row.id);
          started.push(drafts.start(row.id));
        }).immediate();
      }
      return { started, changedSlugs: started.map((d) => d.webSlug!) };
    },
    setReady: vi.fn(), leave: vi.fn(), removePlayer: vi.fn(), stopStart: vi.fn(), setAutoStart: vi.fn(),
  };
}

/** Advance only the injected lobby clock, with the existing engine still real. */
export async function finishTestLobbyStart(response: Response, database?: Database.Database) {
  expect(response.status).toBe(202);
  const body = await response.clone().json() as DraftLobbyResponse;
  expect(body.lobby.start?.kind).toBe("manual");
  const db = database ?? (await import("@/lib/db")).getDb();
  const row = db.prepare("select id from drafts where lobby_start_token = ?").get(body.lobby.start!.token) as { id: number };
  expect(db.prepare("select count(*) as n from draft_cards where draft_id = ?").get(row.id)).toEqual({ n: 0 });
  const api = createTestDraftLobbyApi(db);
  const deadline = new Date(body.lobby.start!.startsAt).getTime();
  expect(api.tick(deadline - 1, row.id).started).toHaveLength(0);
  const result = api.tick(deadline, row.id);
  expect(result.started).toHaveLength(1);
  expect(api.tick(deadline + 1, row.id).started).toHaveLength(0);
  return result.started[0];
}

const auth = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => ({ announcer: { announce: vi.fn() }, broadcaster: { draft: vi.fn() } }));
const service = vi.hoisted(() => ({
  read: vi.fn(), setReady: vi.fn(), leave: vi.fn(), removePlayer: vi.fn(), scheduleStart: vi.fn(),
  stopStart: vi.fn(), setAutoStart: vi.fn(), invalidate: vi.fn(), tick: vi.fn(),
}));
// Importing the fixture from a legacy suite must not register this suite again.
if (expect.getState().testPath?.endsWith("/drafts-lobby-routes.test.ts")) describe("browser lobby contracts", () => {
  let db: Database.Database;
  let projection: DraftLobbyResponse;
  const context = { params: Promise.resolve({ slug: "lobby" }) };
  const request = (method: string, body?: unknown) => new Request("http://localhost/api/drafts/lobby", {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
vi.doMock("@/lib/auth", () => ({ auth }));
vi.doMock("@/lib/db", () => ({ getDb }));
vi.doMock("@/lib/notify", () => notify);
vi.doMock("@/lib/draft-lobby-api", async () => ({
  ...await vi.importActual<typeof import("@/lib/draft-lobby-api")>("@/lib/draft-lobby-api"), createDraftLobbyApi: () => service,
}));


    vi.stubEnv("DISCORD_GUILD_ID", "guild");
    db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
    db.exec(`insert into players (guild_id, discord_user_id, display_name) values ('guild','host','Host');
      insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug)
      values ('guild','channel','Lobby','pending','host','{"mode":"theme","themeSelection":"random","allowedCubeIds":[]}', 'lobby');
      insert into draft_players (draft_id, player_id) values (1,1);`);
    auth.mockResolvedValue({ user: { id: "host" } });
    projection = createTestDraftLobbyApi(db).read(1, "host");
    for (const name of ["read", "setReady", "leave", "removePlayer", "scheduleStart", "stopStart", "setAutoStart"] as const) {
      service[name].mockReturnValue(projection);
    }
    service.tick.mockReturnValue({ started: [], changedSlugs: [] });
  });
  afterEach(() => { db.close(); vi.unstubAllEnvs(); });

  async function route(action: string, method: "POST" | "PUT" | "DELETE", body?: unknown, params = context) {
    const routes = {
      ready: () => import("../app/api/drafts/[slug]/ready/route"),
      leave: () => import("../app/api/drafts/[slug]/join/route"),
      remove: () => import("../app/api/drafts/[slug]/players/[playerId]/route"),
      start: () => import("../app/api/drafts/[slug]/start/route"),
      auto: () => import("../app/api/drafts/[slug]/auto-start/route"),
    };
    const module = await routes[action as keyof typeof routes]();
    return (module as any)[method](request(method, body), params);
  }

  it.each(["ready", "leave", "remove", "start", "auto"])("requires a session for %s", async (action) => {
    auth.mockResolvedValue(null);
    expect((await route(action, action === "auto" ? "PUT" : action === "leave" || action === "remove" ? "DELETE" : "POST")).status).toBe(401);
  });
  it.each(["ready", "leave", "remove", "start", "auto"])("hides a foreign guild lobby at %s", async (action) => {
    db.prepare("update drafts set guild_id = 'foreign'").run();
    expect((await route(action, action === "auto" ? "PUT" : action === "leave" || action === "remove" ? "DELETE" : "POST")).status).toBe(404);
    expect(service.read).not.toHaveBeenCalled();
  });
  it.each(["ready", "leave", "remove", "start", "auto"])("conflicts after start at %s", async (action) => {
    db.prepare("update drafts set status = 'active'").run();
    expect((await route(action, action === "auto" ? "PUT" : action === "leave" || action === "remove" ? "DELETE" : "POST")).status).toBe(409);
  });
  it.each(["remove", "start", "auto"])("requires host ownership at %s", async (action) => {
    auth.mockResolvedValue({ user: { id: "viewer" } });
    expect((await route(action, action === "auto" ? "PUT" : action === "remove" ? "DELETE" : "POST")).status).toBe(403);
  });
  it.each([{}, { ready: "true" }, { ready: 1 }, null, []])("rejects invalid Ready body %j", async (body) => {
    expect((await route("ready", "POST", body)).status).toBe(400);
    expect(service.setReady).not.toHaveBeenCalled();
  });
  it("sets Ready for the session identity and returns the shared projection", async () => {
    const response = await route("ready", "POST", { ready: true, playerId: 999 });
    expect(response.status).toBe(200); expect(await response.json()).toEqual(projection);
    expect(service.setReady).toHaveBeenCalledWith(1, "host", true);
    expect(notify.broadcaster.draft).toHaveBeenCalledWith({ kind: "seats", slug: "lobby" });
  });
  it("allows the host to leave without losing ownership", async () => {
    expect((await route("leave", "DELETE")).status).toBe(200);
    expect(service.leave).toHaveBeenCalledWith(1, "host");
    expect(db.prepare("select created_by_user_id from drafts").get()).toEqual({ created_by_user_id: "host" });
  });
  it.each(["bad", "0", "-1", "1.5", "9007199254740992"])("validates player path %s", async (playerId) => {
    expect((await route("remove", "DELETE", undefined, { params: Promise.resolve({ slug: "lobby", playerId }) } as any)).status).toBe(400);
  });
  it("passes the scoped player ID to the host removal service", async () => {
    expect((await route("remove", "DELETE", undefined, { params: Promise.resolve({ slug: "lobby", playerId: "2" }) } as any)).status).toBe(200);
    expect(service.removePlayer).toHaveBeenCalledWith(1, "host", 2);
  });
  it.each([{}, { revision: -1 }, { revision: 0.5 }, { revision: "0" }, { revision: 0, force: "yes" }])("validates start body %j", async (body) => {
    expect((await route("start", "POST", body)).status).toBe(400);
  });
  it("schedules a 202 response without dealing or announcing a start", async () => {
    const response = await route("start", "POST", { revision: 0, force: true });
    expect(response.status).toBe(202); expect(await response.json()).toEqual(projection);
    expect(service.scheduleStart).toHaveBeenCalledWith(1, "host", { revision: 0, force: true });
    expect(db.prepare("select count(*) as n from draft_cards").get()).toEqual({ n: 0 });
    expect(notify.announcer.announce).not.toHaveBeenCalled();
  });
  it("maps service conflict details without losing NOT_READY information", async () => {
    service.scheduleStart.mockImplementationOnce(() => { throw Object.assign(new Error("Confirm unready seats"), {
      code: "NOT_READY", notReadyPlayerIds: [1], unclaimedPlayerIds: [1],
    }); });
    const response = await route("start", "POST", { revision: 0 });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Confirm unready seats", code: "NOT_READY", notReadyPlayerIds: [1], unclaimedPlayerIds: [1] });
    expect(notify.broadcaster.draft).not.toHaveBeenCalled();
  });
  it.each([{}, { token: "" }, { token: 1 }])("validates Stop body %j", async (body) => {
    expect((await route("start", "DELETE", body)).status).toBe(400);
  });
  it("stops by token and forwards explicit Resume", async () => {
    expect((await route("start", "DELETE", { token: "schedule" })).status).toBe(200);
    expect(service.stopStart).toHaveBeenCalledWith(1, "host", "schedule");
    expect((await route("auto", "PUT", { enabled: true, held: false, revision: 0 })).status).toBe(200);
    expect(service.setAutoStart).toHaveBeenCalledWith(1, "host", { enabled: true, held: false, revision: 0 });
  });
  it.each([{}, { enabled: 1, revision: 0 }, { enabled: true }, { enabled: true, held: "no", revision: 0 }])("validates auto-start body %j", async (body) => {
    expect((await route("auto", "PUT", body)).status).toBe(400);
  });
  it("runs a scoped pending GET tick and notifies only committed starts", async () => {
    const draft = createDraftService(db).findById(1);
    service.tick.mockImplementationOnce(() => {
      db.prepare("update drafts set status = 'active'").run();
      return { started: [{ ...draft, status: "active" }], changedSlugs: ["lobby"] };
    });
    const { GET } = await import("../app/api/drafts/[slug]/route");
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(200); expect((await response.json()).lobby).toBeUndefined();
    expect(service.tick).toHaveBeenCalledWith(expect.any(Number), 1);
    expect(notify.broadcaster.draft).toHaveBeenCalledWith({ kind: "status", slug: "lobby", status: "active" });
    expect(notify.announcer.announce).toHaveBeenCalledWith(expect.objectContaining({ kind: "draft-started", draftId: 1 }));
  });
  it("defaults new web theme lobbies to four seats", async () => {
    vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "channel");
    const { POST } = await import("../app/api/drafts/route");
    const response = await POST(request("POST", { name: "New lobby", config: { mode: "theme" } }) as any);
    expect(response.status).toBe(201);
    const stored = db.prepare("select config_json from drafts where name = 'New lobby'").get() as { config_json: string };
    expect(JSON.parse(stored.config_json).lobbySeats).toBe(4);
  });
  it.each([1, 9, 4.5, "4", null, true])("rejects invalid create seat target %j before writes", async (lobbySeats) => {
    vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "channel");
    const { POST } = await import("../app/api/drafts/route");
    const response = await POST(request("POST", { name: "Bad lobby", config: { mode: "theme", lobbySeats } }) as any);
    expect(response.status).toBe(400);
    expect(db.prepare("select count(*) as n from drafts").get()).toEqual({ n: 1 });
  });
  it("rejects a seat target below the current joined count", async () => {
    db.exec(`insert into players (guild_id,discord_user_id,display_name) values ('guild','p2','Two'),('guild','p3','Three');
      insert into draft_players (draft_id,player_id) values (1,2),(1,3);`);
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(request("PUT", { revision: 0, config: { lobbySeats: 2 } }) as any, context);
    expect(response.status).toBe(409); expect((await response.json()).code).toBe("SEAT_TARGET_TOO_SMALL");
    expect(service.invalidate).not.toHaveBeenCalled();
  });
  it("rejects stale PUT revisions without changing name or config", async () => {
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(request("PUT", { revision: 2, name: "Lost edit" }) as any, context);
    expect(response.status).toBe(409); expect((await response.json()).code).toBe("STALE_LOBBY");
    expect(db.prepare("select name from drafts").get()).toEqual({ name: "Lobby" });
  });
  it("returns the lobby on PUT and preserves acknowledgements for a name-only edit", async () => {
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(request("PUT", { name: "Renamed", revision: 0 }) as any, context);
    expect(response.status).toBe(200); expect((await response.json()).lobby).toEqual(projection.lobby);
    expect(service.invalidate).toHaveBeenCalledWith(1, { clearReady: false });
  });
  it("projects authored distinct and copy counts and strips internal player fields", async () => {
    db.exec(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (1,'Main','Monster','normal','','','[]','now'),(2,'Extra','Fusion Monster','fusion','','','[]','now');
      insert into cubes (guild_id,name,created_by_user_id) values ('guild','Cube','host');
      insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,1,'main',5),(1,2,'extra',3);
      update drafts set config_json = '{"mode":"theme","themeSelection":"player_pick","allowedCubeIds":[1]}';
      insert into draft_player_cube (draft_id,player_id,cube_id) values (1,1,1);`);
    projection = createTestDraftLobbyApi(db).read(1, "viewer");
    service.read.mockReturnValue({ ...projection, players: projection.players.map((p) => ({ ...p, discordUserId: "secret", readySetupHash: "secret" })) });
    auth.mockResolvedValue({ user: { id: "viewer" } });
    const { GET } = await import("../app/api/drafts/[slug]/route");
    const response = await GET(request("GET"), context); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lobby).toEqual(projection.lobby);
    expect(body.players[0]).toMatchObject({ isHost: true, isYou: false, cubeId: 1 });
    expect(body.players[0]).not.toHaveProperty("discordUserId");
    expect(body.players[0]).not.toHaveProperty("readySetupHash");
    expect(body.allowedCubes[0]).toMatchObject({ mainCount: 1, extraCount: 1, mainDistinct: 1, extraDistinct: 1, mainCopies: 5, extraCopies: 3 });
  });

  it("keeps an observer out if the pending GET fallback commits a start", async () => {
    auth.mockResolvedValue({ user: { id: "observer" } });
    service.tick.mockImplementationOnce(() => { db.prepare("update drafts set status = 'active'").run(); return { started: [], changedSlugs: [] }; });
    const { GET } = await import("../app/api/drafts/[slug]/route");
    expect((await GET(request("GET"), context)).status).toBe(403);
  });
  it("rejects a roster join racing a whole host assignment map", async () => {
    db.exec(`insert into cubes (guild_id,name,created_by_user_id) values ('guild','One','host'), ('guild','Two','host');
      update drafts set config_json = '{"mode":"theme","themeSelection":"host_assigned","allowedCubeIds":[1,2],"themeAssignments":{"1":1}}';`);
    const req = request("PUT", { name: "Lost edit", config: { themeAssignments: { "1": 1 } } });
    const text = req.text.bind(req);
    vi.spyOn(req, "text").mockImplementationOnce(async () => {
      db.exec(`insert into players (guild_id,discord_user_id,display_name) values ('guild','joining','Two');
        insert into draft_players (draft_id,player_id) values (1,2);
        update drafts set lobby_revision = lobby_revision + 1;`);
      return text();
    });
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(req as any, context);
    expect(response.status).toBe(409); expect((await response.json()).code).toBe("STALE_LOBBY");
    expect(db.prepare("select name,lobby_revision from drafts").get()).toEqual({ name: "Lobby", lobby_revision: 1 });
  });

  it("clears acknowledgement only for the seat whose host assignment changes", async () => {
    db.exec(`insert into players (guild_id,discord_user_id,display_name) values ('guild','second','Two');
      insert into draft_players (draft_id,player_id) values (1,2);
      insert into cubes (guild_id,name,created_by_user_id) values ('guild','One','host'),('guild','Two','host'),('guild','Three','host');
      update drafts set config_json = '{"mode":"theme","themeSelection":"host_assigned","allowedCubeIds":[1,2,3],"themeAssignments":{"1":1,"2":2}}';`);
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    const response = await PUT(request("PUT", { config: { themeAssignments: { "1": 3, "2": 2 } }, revision: 0 }) as any, context);
    expect(response.status).toBe(200);
    expect(service.invalidate).toHaveBeenCalledWith(1, { clearReady: false, playerIds: [1] });
  });

  it("lets the shared service recognize an identical Start racing hydration", async () => {
    vi.doMock("@yugidraft/shared/services", async () => {
      const original = await vi.importActual<typeof import("@yugidraft/shared/services")>("@yugidraft/shared/services");
      return { ...original, createCardCatalogService: (database: Database.Database) => ({
        ...original.createCardCatalogService(database), syncDraftPool: async () => {
          db.prepare("update drafts set lobby_revision = 1, lobby_start_token = 'first', lobby_start_kind = 'manual'").run();
        },
      }) };
    });
    const response = await route("start", "POST", { revision: 0 });
    expect(response.status).toBe(202);
    expect(service.scheduleStart).toHaveBeenCalledWith(1, "host", { revision: 0, force: false });
    vi.doUnmock("@yugidraft/shared/services");
  });

  it.each([
    { customCardIds: 1 }, { customCardIds: ["1"] }, { cubeCardIds: "1" }, { poolCardIds: {} },
    { setNames: "x" }, { includeNames: [1] }, { excludeNames: null }, { themeAssignments: [] },
  ])("rejects malformed config collections on create and PUT: %j", async (invalid) => {
    vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "channel");
    const before = db.prepare("select name,config_json,lobby_revision from drafts").all();
    const { POST } = await import("../app/api/drafts/route");
    const { PUT } = await import("../app/api/drafts/[slug]/route");
    for (const mode of ["theme", "booster"]) {
      expect((await POST(request("POST", { name: "Malformed", config: { mode, ...invalid } }) as any)).status).toBe(400);
      expect((await PUT(request("PUT", { config: { mode, ...invalid } }) as any, context)).status).toBe(400);
    }
    expect(db.prepare("select name,config_json,lobby_revision from drafts").all()).toEqual(before);
  });

  async function useRealLobbyService() {
    vi.doUnmock("@/lib/draft-lobby-api");
    db.exec(`insert into players (guild_id,discord_user_id,display_name) values ('guild','guest','Guest');
      insert into draft_players (draft_id,player_id) values (1,2);
      insert into cubes (guild_id,name,created_by_user_id) values ('guild','Theme','host');`);
    for (let id = 1; id <= 42; id++) {
      db.prepare(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
        values (?,?,'Normal Monster','normal','','','[]','now')`).run(id, `Card ${id}`);
      db.prepare("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,?,'main',1)").run(id);
    }
    db.prepare("update drafts set config_json = ?").run(JSON.stringify({
      mode: "theme", themeSelection: "random", allowedCubeIds: [1], uniqueThemes: false,
      extraDeckEnabled: false, lobbySeats: 2, cardsPerPlayer: 40, themePackSize: 3, pickSeconds: 45,
    }));
    const { createDraftLobbyApi } = await import("@/lib/draft-lobby-api");
    return createDraftLobbyApi(db);
  }
  // The T01-only branch skips these two. A read-only services alias to committed
  // T03 source runs them before integration without changing packages/shared.
  it.skipIf(!("createDraftLobbyService" in sharedServices))("T03 runtime: Ready, manual retry/Stop, auto Hold/Resume and GET expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    try {
      const api = await useRealLobbyService();
      const unready = await route("start", "POST", { revision: api.read(1, "host").lobby.revision });
      expect(unready.status).toBe(409); expect((await unready.json()).code).toBe("NOT_READY");
      expect((await route("ready", "POST", { ready: true })).status).toBe(200);
      auth.mockResolvedValue({ user: { id: "guest" } });
      expect((await route("ready", "POST", { ready: true })).status).toBe(200);
      auth.mockResolvedValue({ user: { id: "host" } });
      const revision = api.read(1, "host").lobby.revision;
      const scheduled = await route("start", "POST", { revision }); expect(scheduled.status).toBe(202);
      const first = await scheduled.json() as DraftLobbyResponse;
      expect(new Date(first.lobby.start!.startsAt).getTime() - Date.now()).toBe(5000);
      vi.setSystemTime(Date.now() + 1000);
      const repeated = await route("start", "POST", { revision }); expect(repeated.status).toBe(202);
      expect((await repeated.json()).lobby.start).toEqual(first.lobby.start);
      expect(db.prepare("select count(*) as n from draft_cards").get()).toEqual({ n: 0 });
      expect((await route("start", "DELETE", { token: "wrong" })).status).toBe(409);
      expect((await route("start", "DELETE", { token: first.lobby.start!.token })).status).toBe(200);
      const enabled = await route("auto", "PUT", { enabled: true, revision: api.read(1, "host").lobby.revision });
      expect(enabled.status).toBe(200);
      const auto = (await enabled.json()).lobby;
      expect(new Date(auto.start.startsAt).getTime() - Date.now()).toBe(10000);
      expect((await route("auto", "PUT", { enabled: true, held: true, revision: auto.revision })).status).toBe(200);
      vi.setSystemTime(Date.now() + 20000);
      const { GET } = await import("../app/api/drafts/[slug]/route");
      const held = await GET(request("GET"), context); expect(held.status).toBe(200);
      expect((await held.json()).lobby).toMatchObject({ start: null, autoStart: { held: true } });
      const resumed = await route("auto", "PUT", { enabled: true, held: false, revision: api.read(1, "host").lobby.revision });
      const resumedLobby = (await resumed.json()).lobby;
      expect(new Date(resumedLobby.start.startsAt).getTime() - Date.now()).toBe(10000);
      vi.setSystemTime(new Date(resumedLobby.start.startsAt));
      const active = await GET(request("GET"), context); expect(active.status).toBe(200);
      expect(await active.json()).toMatchObject({ status: "active" });
      expect(db.prepare("select count(*) as n from draft_cards").get()).toEqual({ n: 6 });
      await GET(request("GET"), context);
      expect(notify.announcer.announce).toHaveBeenCalledTimes(1);
      expect((await route("ready", "POST", { ready: false })).status).toBe(409);
    } finally { vi.useRealTimers(); }
  });
  it.skipIf(!("createDraftLobbyService" in sharedServices))("T03 runtime: host Leave, scoped removal and unready rejoin", async () => {
    const api = await useRealLobbyService();
    expect((await route("leave", "DELETE")).status).toBe(200);
    expect((await route("leave", "DELETE")).status).toBe(200);
    expect(api.read(1, "host").lobby.joined).toBe(1);
    expect(db.prepare("select created_by_user_id from drafts").get()).toEqual({ created_by_user_id: "host" });
    expect((await route("remove", "DELETE", undefined, { params: Promise.resolve({ slug: "lobby", playerId: "2" }) } as any)).status).toBe(200);
    expect((await route("remove", "DELETE", undefined, { params: Promise.resolve({ slug: "lobby", playerId: "2" }) } as any)).status).toBe(404);
    const { POST } = await import("../app/api/drafts/[slug]/join/route");
    expect((await POST(request("POST"), context)).status).toBe(200);
    expect(api.read(1, "host").players[0]).toMatchObject({ isHost: true, ready: false, cubeId: null });
    expect((await route("remove", "DELETE", undefined, { params: Promise.resolve({ slug: "lobby", playerId: "1" }) } as any)).status).toBe(400);
  });

});
