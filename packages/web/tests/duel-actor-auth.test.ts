import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createUserService } from "@yugidraft/shared/services";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(state.auth);
});
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));

const discordUserId = "900000000000000007";
let userId: number;

beforeEach(() => {
  vi.resetModules();
  state.auth.mockReset();
  state.db = new Database(":memory:");
  migrate(state.db);
  userId = createUserService(state.db).ensureDiscord({ discordUserId, displayName: "Yugi" }).id;
  state.auth.mockResolvedValue({ user: { id: String(userId), discordUserId, name: "Yugi" } });
  vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected Discord I/O"); }));
});
afterEach(() => {
  state.db?.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const playerCount = () => state.db!.prepare("select count(*) as c from players").get();

describe("requireDuelActor signed-in access", () => {
  it("creates the signed-in player, preserving independent player and user IDs", async () => {
    state.db!.prepare("insert into players(id,guild_id,user_id,discord_user_id,display_name) values(61,?,?,?,?)")
      .run("historical-guild", userId, discordUserId, "Old Yugi");
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const actor = await requireDuelActor();
    expect(actor.ok).toBe(true);
    if (!actor.ok) throw new Error("expected signed-in actor");
    expect(actor.guildId).toBe("guild-1");
    expect(actor.userId).toBe(userId);
    expect(actor.playerId).toBe(62);
    expect(actor.playerId).not.toBe(userId);
    expect(state.db!.prepare("select user_id,discord_user_id from players where id=?").get(actor.playerId))
      .toEqual({ user_id: userId, discord_user_id: discordUserId });
    expect(state.db!.prepare("select id,display_name from players where guild_id='historical-guild'").get())
      .toEqual({ id: 61, display_name: "Old Yugi" });
    expect((await requireDuelActor()).ok).toBe(true);
    expect(playerCount()).toEqual({ c: 2 });
    expect(fetch).not.toHaveBeenCalledWith(`https://discord.com/api/v10/guilds/guild-1/members/${userId}`, expect.any(Object));
  });

  it("does not create a player when signed out", async () => {
    state.auth.mockResolvedValue(null);
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const actor = await requireDuelActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected signed-out actor to fail");
    expect(actor.response.status).toBe(401);
    expect(playerCount()).toEqual({ c: 0 });
  });

  it("does not create a player when account resolution is unavailable", async () => {
    state.auth.mockRejectedValue(new Error("Session unavailable"));
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const actor = await requireDuelActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected unavailable session to fail");
    expect(actor.response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(playerCount()).toEqual({ c: 0 });
  });
});

describe("common web actor boundary", () => {
  it.each([101, null, undefined, "", "0", "01", " 1", "+1", "1.0", "1e3", "-1", "9007199254740992", discordUserId])("rejects malformed session ID %s before player creation", async (id) => {
    state.auth.mockResolvedValue({ user: { id, discordUserId, name: "Yugi" } });
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const actor = await requireDuelActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected invalid identity to fail");
    expect(actor.response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(playerCount()).toEqual({ c: 0 });
  });

  it.each([null, undefined, ""])("allows an email-only identity %s", async discordId => {
    state.auth.mockResolvedValue({ user: { id: String(userId), discordUserId: discordId, name: "Yugi" } });
    const { requireWebAccess } = await import("../src/lib/web-access");
    expect(await requireWebAccess()).toEqual({ ok: true, userId, discordUserId: null, userName: "Yugi" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the integer application identity without Discord calls", async () => {
    const { requireWebAccess } = await import("../src/lib/web-access");
    expect(await requireWebAccess()).toEqual({ ok: true, userId, discordUserId, userName: "Yugi" });
    expect(fetch).not.toHaveBeenCalledWith(`https://discord.com/api/v10/guilds/guild-1/members/${userId}`, expect.any(Object));
  });

  it("returns 503 when the session is unavailable", async () => {
    state.auth.mockRejectedValue(new Error("Session unavailable"));
    const { requireWebAccess } = await import("../src/lib/web-access");
    const actor = await requireWebAccess();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected admin denial");
    expect(actor.response.status).toBe(503);
  });
});

describe("saved-deck actor", () => {
  it("resolves an integer owner through the common signed-in guard without creating a player", async () => {
    const { requireSavedDeckActor, loadDeckRegistrations } = await import("../src/lib/saved-decks");
    const actor = await requireSavedDeckActor();
    expect(actor.ok).toBe(true);
    if (!actor.ok) throw new Error("expected saved-deck actor");
    expect(actor).toMatchObject({ guildId: "guild-1", ownerUserId: userId, discordUserId });
    expect(loadDeckRegistrations("guild-1", actor.ownerUserId)).toEqual([]);
    expect(playerCount()).toEqual({ c: 0 });
  });

  it.each([401, 503])("blocks deck access on session failure %s", async (status) => {
    if (status === 401) state.auth.mockResolvedValue(null);
    else state.auth.mockRejectedValue(new Error("Session unavailable"));
    const { requireSavedDeckActor } = await import("../src/lib/saved-decks");
    const actor = await requireSavedDeckActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected deck access denial");
    expect(actor.response.status).toBe(status);
    expect(playerCount()).toEqual({ c: 0 });
  });

  it("rejects a numeric JSON session ID before accessing saved decks", async () => {
    state.auth.mockResolvedValue({ user: { id: userId, discordUserId } });
    const { requireSavedDeckActor } = await import("../src/lib/saved-decks");
    const actor = await requireSavedDeckActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected invalid owner denial");
    expect(actor.response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("cube creator ownership", () => {
  function cube(guildId = "guild-1") {
    return Number(state.db!.prepare("insert into cubes(guild_id,name,created_by_user_id) values(?,?,?)")
      .run(guildId, "Owner cube", userId).lastInsertRowid);
  }

  it("compares integer owner IDs without asking Discord for owner writes", async () => {
    const cubeId = cube();
    const { cubeOwnerAccess } = await import("../src/lib/cube-access");
    expect(await cubeOwnerAccess(state.db!, cubeId, { userId })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a former admin who is not the creator", async () => {
    const cubeId = cube();
    const admin = createUserService(state.db!).ensureDiscord({ discordUserId: "900000000000000102", displayName: "Admin" });
    const { cubeOwnerAccess } = await import("../src/lib/cube-access");
    expect((await cubeOwnerAccess(state.db!, cubeId, { userId: admin.id }))?.status).toBe(404);
    expect(fetch).not.toHaveBeenCalledWith(`https://discord.com/api/v10/guilds/guild-1/members/${admin.id}`, expect.any(Object));
  });

  it("denies a non-creator without external checks", async () => {
    const cubeId = cube();

    const { cubeOwnerAccess } = await import("../src/lib/cube-access");
    const response = await cubeOwnerAccess(state.db!, cubeId, { userId: userId + 1 });
    expect(response?.status).toBe(404);
  });

  it("denies a non-creator even without Discord", async () => {
    const cubeId = cube();

    const { cubeOwnerAccess } = await import("../src/lib/cube-access");
    const response = await cubeOwnerAccess(state.db!, cubeId, { userId: userId + 1 });
    expect(response?.status).toBe(404);
  });

  it("does not expose a cube from a historical guild even to its owner", async () => {
    const cubeId = cube("historical-guild");
    const { cubeOwnerAccess } = await import("../src/lib/cube-access");
    expect((await cubeOwnerAccess(state.db!, cubeId, { userId }))?.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("remote duel API foundation", () => {
  const request = (path: string, body?: unknown) => new Request(`http://localhost/api/remote${path}`, {
    method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  it("defaults off and uses the shared signed-in boundary when enabled", async () => {
    const { GET, POST } = await import("../app/api/remote/route");
    expect((await GET(request(""))).status).toBe(404);
    vi.stubEnv("REMOTE_DUELS", "1"); state.auth.mockResolvedValue(null);
    expect((await POST(request("", { gameId: "ygo", seatCount: 2 }))).status).toBe(401);
  });
  it("runs create, join, ready, start and an action using persisted seat identity", async () => {
    vi.stubEnv("REMOTE_DUELS", "1");
    const { GET, POST } = await import("../app/api/remote/route");
    const created = await POST(request("", { gameId: "ygo", seatCount: 2 }));
    expect(created.status).toBe(201);
    let room = await created.json(); const context = { params: Promise.resolve({ slug: room.slug }) };
    const { GET: read } = await import("../app/api/remote/[slug]/route");
    const guest = createUserService(state.db!).ensureDiscord({ discordUserId: "900000000000000008", displayName: "Guest" }).id;
    state.auth.mockResolvedValue({ user: { id: String(guest), name: "Guest" } });
    expect((await read(request(`/${room.slug}`), context)).status).toBe(404);
    const { POST: join } = await import("../app/api/remote/[slug]/seat/route");
    expect((await join(request(`/${room.slug}/seat`, { seat: 1 }), context)).status).toBe(200);
    const { POST: ready } = await import("../app/api/remote/[slug]/ready/route");
    await ready(request(`/${room.slug}/ready`, { ready: true }), context);
    state.auth.mockResolvedValue({ user: { id: String(userId), name: "Yugi" } });
    await ready(request(`/${room.slug}/ready`, { ready: true }), context);
    const { POST: start } = await import("../app/api/remote/[slug]/start/route");
    room = await (await start(request(`/${room.slug}/start`, {}), context)).json();
    const { POST: act } = await import("../app/api/remote/[slug]/actions/route");
    const command = { baseSeq: room.lastSeq, action: { type: "lp.change", actorSeat: 0, idempotencyKey: "damage", seat: 1, delta: -500, reason: "effect" } };
    const response = await act(request(`/${room.slug}/actions`, command), context);
    expect(response.status).toBe(200); expect((await response.json()).state.seats[1].resources.lp).toBe(7500);
    expect((await act(request(`/${room.slug}/actions`, { ...command, action: { ...command.action, actorSeat: 1, idempotencyKey: "spoof" } }), context)).status).toBe(403);
    expect((await GET(request("?scope=mine"))).status).toBe(200);
    expect(playerCount()).toEqual({ c: 0 });
  });
  it("keeps connection identity server-side and returns 503 for missing media config", async () => {
    vi.stubEnv("REMOTE_DUELS", "1"); vi.stubEnv("WS_INTERNAL_SECRET", "remote-secret");
    const { POST } = await import("../app/api/remote/route");
    const room = await (await POST(request("", { gameId: "ygo", seatCount: 2 }))).json();
    const context = { params: Promise.resolve({ slug: room.slug }) };
    const { GET } = await import("../app/api/remote/[slug]/connection/route");
    expect((await GET(request(`/${room.slug}/connection?as=1`), context)).status).toBe(400);
    const connection = await (await GET(request(`/${room.slug}/connection`), context)).json();
    const { verifyRemoteConnectionToken } = await import("@yugidraft/shared/ws");
    expect(verifyRemoteConnectionToken(connection.token, "remote-secret")).toMatchObject({ userId, seat: 0, guildId: "guild-1" });
    const { POST: livekit } = await import("../app/api/remote/[slug]/livekit/route");
    const response = await livekit(request(`/${room.slug}/livekit`, {}), context);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("LIVEKIT_UNAVAILABLE");
  });
});
