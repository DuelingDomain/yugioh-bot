import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";

const { auth, database, checkDiscordWebAccess, announce, read, createDraftLobbyService } = vi.hoisted(() => ({
  auth: vi.fn(), database: { current: null as Database.Database | null },
  checkDiscordWebAccess: vi.fn(), announce: vi.fn(), read: vi.fn(), createDraftLobbyService: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ getDb: () => database.current! }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "guild-1" } }));
vi.mock("@/lib/discord-web-access", () => ({ checkDiscordWebAccess, webAccessError: () => "Membership unavailable" }));
vi.mock("@/lib/notify", () => ({ announcer: { announce } }));
vi.mock("@yugidraft/shared/services", () => ({
  isTestBotDiscordId: (id: string) => id.startsWith("bot_player_dev_"), createDraftLobbyService,
}));
vi.mock("@yugidraft/shared/types", () => import("../../shared/src/types/index"));

async function nudge(body: unknown = {}, raw = false, slug = "night") {
  const { POST } = await import("../app/api/drafts/[slug]/nudge/route");
  return POST(new Request(`http://localhost/api/drafts/${slug}/nudge`, {
    method: "POST", body: raw ? String(body) : JSON.stringify(body),
  }), { params: Promise.resolve({ slug }) });
}
function nudgedAt() {
  return (database.current!.prepare("select lobby_nudged_at as at from drafts where id = 1").get() as { at: string | null }).at;
}

describe("draft Nudge route", () => {
  beforeEach(() => {
    vi.stubEnv("DISCORD_BOT_ENABLED", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
    database.current = new Database(":memory:");
    migrate(database.current);
    database.current.prepare(`insert into drafts (id, guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug)
      values (1, 'guild-1', 'stored-channel', 'Night', 'pending', 'host', '{}', 'night')`).run();
    for (const [id, user] of [[1, "123456789012345678"], [2, "234567890123456789"], [3, "bot_player_dev_1"], [4, "not-a-snowflake"]] as const) {
      database.current.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (?, 'guild-1', ?, 'Player')").run(id, user);
      database.current.prepare("insert into draft_players (draft_id, player_id, seat_index) values (1, ?, ?)").run(id, id - 1);
    }
    auth.mockResolvedValue({ user: { id: "host" } });
    checkDiscordWebAccess.mockResolvedValue({ ok: true });
    announce.mockResolvedValue({ ok: true });
    createDraftLobbyService.mockReturnValue({ read });
    read.mockReturnValue({ players: [
      { playerId: 1, ready: false, isBot: false }, { playerId: 2, ready: true, isBot: false },
      { playerId: 3, ready: true, isBot: true }, { playerId: 4, ready: false, isBot: false },
    ] });
  });
  afterEach(() => { database.current!.close(); vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllEnvs(); });

  it("sends an invite with current unready humans through the signed announcer", async () => {
    const response = await nudge();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, channelId: "stored-channel", nextAllowedAt: "2026-10-07T15:01:00.000Z" });
    expect(announce).toHaveBeenCalledWith({ kind: "draft-nudge", draftId: 1, channelId: "stored-channel", name: "Night", webSlug: "night", mentionUserIds: ["123456789012345678"] });
    expect(nudgedAt()).toBe("2026-10-07T15:00:00.000Z");
    expect(database.current!.prepare("select lobby_revision as revision from drafts where id = 1").get()).toEqual({ revision: 0 });
  });

  it("uses persisted readiness from the real shared lobby service", async () => {
    const services = await vi.importActual<typeof import("@yugidraft/shared/services")>("@yugidraft/shared/services");
    createDraftLobbyService.mockImplementation(services.createDraftLobbyService);
    const lobby = services.createDraftLobbyService(database.current!);
    lobby.setReady(1, "234567890123456789", true);
    const revision = lobby.read(1).lobby.revision;
    read.mockClear();
    expect((await nudge()).status).toBe(200);
    expect(announce.mock.calls[0][0].mentionUserIds).toEqual(["123456789012345678"]);
    expect(lobby.read(1).lobby.revision).toBe(revision);
    expect(read).not.toHaveBeenCalled();
  });

  it("targets one joined unready human", async () => {
    expect((await nudge({ playerId: 1 })).status).toBe(200);
    expect(announce.mock.calls[0][0].mentionUserIds).toEqual(["123456789012345678"]);
  });

  it("allows signup invites when all seats are ready or the lobby is empty", async () => {
    read.mockReturnValue({ players: [] });
    expect((await nudge()).status).toBe(200);
    expect(announce.mock.calls[0][0].mentionUserIds).toEqual([]);
  });

  it.each([2, 3, 4, 99])("rejects target %s without reserving or sending", async playerId => {
    expect((await nudge({ playerId })).status).toBe(400);
    expect(nudgedAt()).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it.each([null, [], { playerId: "1" }, { playerId: 0 }, { playerId: 1.5 }, { channelId: "arbitrary" }])("rejects invalid body %j", async body => {
    expect((await nudge(body)).status).toBe(400);
    expect(nudgedAt()).toBeNull();
  });
  it("does not exist while the Discord bot is shelved", async () => {
    vi.stubEnv("DISCORD_BOT_ENABLED", "");
    expect((await nudge("{}", true)).status).toBe(404);
    expect(announce).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => { expect((await nudge("{", true)).status).toBe(400); });

  it.each([
    ["session", 401], ["member", 403], ["membership-outage", 503], ["other-host", 403], ["cross-guild", 404], ["missing", 404], ["active", 409],
  ])("enforces %s boundary", async (boundary, status) => {
    if (boundary === "session") auth.mockResolvedValue(null);
    if (boundary === "member") checkDiscordWebAccess.mockResolvedValue({ ok: false, status: 403 });
    if (boundary === "membership-outage") checkDiscordWebAccess.mockResolvedValue({ ok: false, status: 503 });
    if (boundary === "other-host") auth.mockResolvedValue({ user: { id: "outsider" } });
    if (boundary === "cross-guild") database.current!.prepare("update drafts set guild_id = 'guild-2' where id = 1").run();
    if (boundary === "active") database.current!.prepare("update drafts set status = 'active' where id = 1").run();
    expect((await nudge({}, false, boundary === "missing" ? "absent" : "night")).status).toBe(status);
    expect(announce).not.toHaveBeenCalled();
    expect(nudgedAt()).toBeNull();
  });

  it("reserves across concurrent requests and returns Retry-After until the exact cooldown boundary", async () => {
    let delivered!: (result: { ok: true }) => void;
    let sending!: () => void;
    const entered = new Promise<void>(resolve => { sending = resolve; });
    announce.mockImplementation(() => new Promise(resolve => { delivered = resolve; sending(); }));
    const first = nudge();
    await entered;
    const second = await nudge();
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("60");
    expect(await second.json()).toMatchObject({ code: "NUDGE_COOLDOWN", retryAfterSeconds: 60 });
    expect(announce).toHaveBeenCalledTimes(1);
    delivered({ ok: true });
    expect((await first).status).toBe(200);
    vi.advanceTimersByTime(59_001);
    expect((await nudge()).headers.get("Retry-After")).toBe("1");
    vi.advanceTimersByTime(999);
    announce.mockResolvedValue({ ok: true });
    expect((await nudge()).status).toBe(200);
  });

  it.each(["result", "throw"])("releases its failed %s reservation and allows retry", async failure => {
    if (failure === "result") announce.mockResolvedValue({ ok: false, error: "Cannot send" });
    else announce.mockRejectedValue(new Error("Offline"));
    expect((await nudge()).status).toBe(502);
    expect(nudgedAt()).toBeNull();
    announce.mockResolvedValue({ ok: true });
    expect((await nudge()).status).toBe(200);
  });

  it("does not erase a newer reservation when an older delivery fails", async () => {
    announce.mockImplementation(async () => {
      database.current!.prepare("update drafts set lobby_nudged_at = '2026-10-07T15:02:00.000Z' where id = 1").run();
      return { ok: false, error: "Old delivery failed" };
    });
    expect((await nudge()).status).toBe(502);
    expect(nudgedAt()).toBe("2026-10-07T15:02:00.000Z");
  });
});
