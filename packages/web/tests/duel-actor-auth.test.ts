import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createUserService } from "@yugidraft/shared/services";
import { mockDiscordAccess } from "./fixtures/discord-access";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));

let discord: ReturnType<typeof mockDiscordAccess>;
const discordUserId = "196382527131222016";
let userId: number;

beforeEach(() => {
  vi.resetModules();
  state.auth.mockReset();
  state.db = new Database(":memory:");
  migrate(state.db);
  userId = createUserService(state.db).ensureDiscord({ discordUserId, displayName: "Yugi" }).id;
  state.auth.mockResolvedValue({ user: { id: String(userId), discordUserId, name: "Yugi" } });
  vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  discord = mockDiscordAccess();
});
afterEach(() => {
  state.db?.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const playerCount = () => state.db!.prepare("select count(*) as c from players").get();

describe("requireDuelActor guild membership", () => {
  it("creates the player after Discord confirms membership, preserving independent player and user IDs", async () => {
    state.db!.prepare("insert into players(id,guild_id,user_id,discord_user_id,display_name) values(61,?,?,?,?)")
      .run("historical-guild", userId, discordUserId, "Old Yugi");
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const actor = await requireDuelActor();
    expect(actor.ok).toBe(true);
    if (!actor.ok) throw new Error("expected member actor");
    expect(actor.guildId).toBe("guild-1");
    expect(actor.playerId).toBe(62);
    expect(actor.playerId).not.toBe(userId);
    expect(state.db!.prepare("select user_id,discord_user_id from players where id=?").get(actor.playerId))
      .toEqual({ user_id: userId, discord_user_id: discordUserId });
    expect(state.db!.prepare("select id,display_name from players where guild_id='historical-guild'").get())
      .toEqual({ id: 61, display_name: "Old Yugi" });
    expect((await requireDuelActor()).ok).toBe(true);
    expect(playerCount()).toEqual({ c: 2 });
    expect(fetch).toHaveBeenCalledWith(`https://discord.com/api/v10/guilds/guild-1/members/${discordUserId}`, expect.any(Object));
    expect(fetch).not.toHaveBeenCalledWith(`https://discord.com/api/v10/guilds/guild-1/members/${userId}`, expect.any(Object));
  });

  it("does not create a player for an outsider", async () => {
    discord.memberStatus = 404;
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const actor = await requireDuelActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected outsider to fail");
    expect(actor.response.status).toBe(403);
    expect(playerCount()).toEqual({ c: 0 });
  });

  it("does not create a player when membership cannot be verified", async () => {
    vi.stubEnv("DISCORD_TOKEN", "");
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const actor = await requireDuelActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected unavailable membership to fail");
    expect(actor.response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(playerCount()).toEqual({ c: 0 });
  });
});

describe("common web actor boundary", () => {
  it.each([101, null, undefined, "", "0", "01", " 1", "+1", "1.0", "1e3", "-1", "9007199254740992", discordUserId])("rejects malformed session ID %s before membership or player creation", async (id) => {
    state.auth.mockResolvedValue({ user: { id, discordUserId, name: "Yugi" } });
    const { requireDuelActor } = await import("../src/lib/duel-host");
    const actor = await requireDuelActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected invalid identity to fail");
    expect(actor.response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(playerCount()).toEqual({ c: 0 });
  });

  it.each([null, undefined, ""])("requires separate Discord identity %s", async (discordId) => {
    state.auth.mockResolvedValue({ user: { id: String(userId), discordUserId: discordId } });
    const { requireWebAccess } = await import("../src/lib/web-access");
    const actor = await requireWebAccess();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected missing Discord identity to fail");
    expect(actor.response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns an integer owner and checks admin privileges through the Discord ID", async () => {
    const { requireWebAccess } = await import("../src/lib/web-access");
    expect(await requireWebAccess("admin")).toEqual({ ok: true, userId, discordUserId, userName: "Yugi" });
    expect(fetch).toHaveBeenCalledWith(`https://discord.com/api/v10/guilds/guild-1/members/${discordUserId}`, expect.any(Object));
    expect(fetch).not.toHaveBeenCalledWith(`https://discord.com/api/v10/guilds/guild-1/members/${userId}`, expect.any(Object));
  });

  it("retains admin denial for members without manage-server permission", async () => {
    discord.permissions = "0";
    const { requireWebAccess } = await import("../src/lib/web-access");
    const actor = await requireWebAccess("admin");
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected admin denial");
    expect(actor.response.status).toBe(403);
  });
});

describe("saved-deck actor", () => {
  it("resolves an integer owner through the common member guard without creating a player", async () => {
    const { requireSavedDeckActor, loadDeckRegistrations } = await import("../src/lib/saved-decks");
    const actor = await requireSavedDeckActor();
    expect(actor.ok).toBe(true);
    if (!actor.ok) throw new Error("expected saved-deck actor");
    expect(actor).toMatchObject({ guildId: "guild-1", ownerUserId: userId, discordUserId });
    expect(loadDeckRegistrations("guild-1", actor.ownerUserId)).toEqual([]);
    expect(playerCount()).toEqual({ c: 0 });
    expect(fetch).toHaveBeenCalledWith(`https://discord.com/api/v10/guilds/guild-1/members/${discordUserId}`, expect.any(Object));
  });

  it.each([404, 500])("blocks deck access when Discord returns %s", async (status) => {
    discord.memberStatus = status;
    const { requireSavedDeckActor } = await import("../src/lib/saved-decks");
    const actor = await requireSavedDeckActor();
    expect(actor.ok).toBe(false);
    if (actor.ok) throw new Error("expected deck access denial");
    expect(actor.response.status).toBe(status === 404 ? 403 : 503);
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

describe("cube ownership and explicit Discord admin override", () => {
  function cube(guildId = "guild-1") {
    return Number(state.db!.prepare("insert into cubes(guild_id,name,created_by_user_id) values(?,?,?)")
      .run(guildId, "Owner cube", userId).lastInsertRowid);
  }

  it("compares integer owner IDs without asking Discord for owner writes", async () => {
    const cubeId = cube();
    const { cubeWriteAccess } = await import("../src/lib/cube-access");
    expect(await cubeWriteAccess(state.db!, cubeId, { userId, discordUserId })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a non-owner only through their separate Discord admin identity", async () => {
    const cubeId = cube();
    const admin = createUserService(state.db!).ensureDiscord({ discordUserId: "900000000000000102", displayName: "Admin" });
    const { cubeWriteAccess } = await import("../src/lib/cube-access");
    expect(await cubeWriteAccess(state.db!, cubeId, { userId: admin.id, discordUserId: admin.discordUserId! })).toBeNull();
    expect(fetch).toHaveBeenCalledWith("https://discord.com/api/v10/guilds/guild-1/members/900000000000000102", expect.any(Object));
    expect(fetch).not.toHaveBeenCalledWith(`https://discord.com/api/v10/guilds/guild-1/members/${admin.id}`, expect.any(Object));
  });

  it("denies a non-owner without admin privileges", async () => {
    const cubeId = cube();
    discord.permissions = "0";
    const { cubeWriteAccess } = await import("../src/lib/cube-access");
    const response = await cubeWriteAccess(state.db!, cubeId, { userId: userId + 1, discordUserId: "900000000000000102" });
    expect(response?.status).toBe(403);
  });

  it("retains 503 when the admin check is unavailable", async () => {
    const cubeId = cube();
    discord.guildStatus = 500;
    const { cubeWriteAccess } = await import("../src/lib/cube-access");
    const response = await cubeWriteAccess(state.db!, cubeId, { userId: userId + 1, discordUserId: "900000000000000102" });
    expect(response?.status).toBe(503);
  });

  it("does not expose a cube from a historical guild even to its owner", async () => {
    const cubeId = cube("historical-guild");
    const { cubeWriteAccess } = await import("../src/lib/cube-access");
    expect((await cubeWriteAccess(state.db!, cubeId, { userId, discordUserId }))?.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
