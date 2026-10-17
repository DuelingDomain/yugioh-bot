// @vitest-environment jsdom
import Database from "better-sqlite3";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";

const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/lib/duel-host", async original => ({ ...await original<object>(), requireDuelActor: mocks.actor }));
vi.mock("@/lib/replay-fork-access", () => ({ assertDuelForkAccess: () => ({ kind: "play" }) }));
vi.mock("@/lib/env", () => ({ env: { wsInternalSecret: "waiting-token-fixture" } }));
vi.mock("socket.io-client", () => ({ io: () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: "waiting-socket", connected: false,
    on(event: string, handler: (...args: unknown[]) => void) { handlers.set(event, handler); },
    timeout() { return { emit(_event: string, _body: unknown, ack: (error: null, result: unknown) => void) {
      ack(null, { ok: true, onlineSeats: [0], spectatorCount: 0 });
    } }; },
    emit() {}, off() {},
    connect() { socket.connected = true; handlers.get("connect")?.(); },
    disconnect() { socket.connected = false; },
  };
  return socket;
} }));
import { GET } from "../app/api/duels/[slug]/connection/route";
import { POST as activityPost } from "../app/api/duels/[slug]/activity/route";
import { useDuelRoomActivity } from "@/lib/hooks/use-duel-room-activity";
import { useDuelWebsocket } from "@/lib/hooks/use-duel-websocket";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("expires a passive room at ten minutes and keeps seats during active deck work", async () => {
  const db = new Database(":memory:"); migrate(db); seedFixtureUsers(db, ["host", "guest", "watcher"]);
  const playerId = Number(db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values('g',?,?,?)")
    .run(fixtureUserId("host"), fixtureDiscordId("host"), "Host").lastInsertRowid);
  const duels = createDuelService(db);
  const table = duels.create({ guildId: "g", organizerPlayerId: playerId, name: "Private wait", mode: "normal", settings: { visibility: "private" } });
  mocks.actor.mockResolvedValue({ ok: true, guildId: "g", playerId, duels });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T12:00:00.000Z"));
  db.prepare("update duels set last_activity_at = ? where id = ?").run(new Date().toISOString(), table.id);
  const fetchToken = vi.fn(() => GET(new Request(`http://localhost/api/duels/${table.slug}/connection`), { params: Promise.resolve({ slug: table.slug }) }));
  vi.stubGlobal("fetch", fetchToken);
  try {
    const view = renderHook(() => useDuelWebsocket(table.slug, 0, async () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.connected).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 - 1); });
    expect(duels.expireWaitingTables(Date.now(), 10)).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(duels.expireWaitingTables(Date.now(), 10).map(row => row.slug)).toEqual([table.slug]);
    expect(fetchToken.mock.calls.length).toBeGreaterThanOrEqual(3);
    view.unmount();

    const addPlayer = (key: string) => Number(db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values('g',?,?,?)")
      .run(fixtureUserId(key), fixtureDiscordId(key), key).lastInsertRowid);
    const guest = addPlayer("guest");
    const watcher = addPlayer("watcher");
    const editing = duels.create({ guildId: "g", organizerPlayerId: playerId, name: "Deck work", mode: "domain", format: "tag",
      settings: { genesys: { pointCap: 100 } } });
    duels.takeSeat(editing.slug, "g", guest, 2);
    db.prepare("update duels set settings_json = json_set(settings_json, '$.visibility', 'private') where id = ?").run(editing.id);
    const context = { params: Promise.resolve({ slug: editing.slug }) };
    const inputRequest = () => new Request(`http://localhost/api/duels/${editing.slug}/activity`, { method: "POST" });
    const as = (id: number, guildId = "g") => mocks.actor.mockResolvedValue({ ok: true, guildId, playerId: id, duels });
    as(watcher);
    expect((await activityPost(inputRequest(), context)).status).toBe(403);
    as(guest, "other-guild");
    expect((await activityPost(inputRequest(), context)).status).toBe(404);
    as(guest);
    const activityFetch = vi.fn(() => activityPost(inputRequest(), context));
    vi.stubGlobal("fetch", activityFetch);
    const editor = renderHook(() => useDuelRoomActivity(editing.slug));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(await (await activityFetch.mock.results[0]!.value).json()).toEqual({
      slug: editing.slug, idleTimeoutMs: 600_000, idleDeadlineAt: new Date(Date.now() + 600_000).toISOString(),
    });
    for (let minute = 0; minute < 3; minute++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9 * 60_000);
        window.dispatchEvent(new Event("keydown"));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(duels.expireWaitingTables(Date.now(), 10)).toEqual([]);
      expect(duels.room(editing.slug, "g", guest)).toMatchObject({ mySeat: 2, session: { status: "lobby", seats: [{ seat: 0 }, { seat: 2 }] } });
    }
    // The player can return with the same seat and submit a repaired deck.
    duels.setDeck(editing.slug, "g", guest, { main: Array(40).fill(1), extra: [], side: [], deckMaster: 2 });
    expect(duels.room(editing.slug, "g", guest).myDeck?.main).toHaveLength(40);
    editor.unmount();
    const inputs = activityFetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000 - 1); });
    expect(duels.expireWaitingTables(Date.now(), 10)).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect((await activityPost(inputRequest(), context)).status).toBe(409);
    expect(() => duels.setDeck(editing.slug, "g", guest, { main: Array(40).fill(1), extra: [], side: [], deckMaster: 2 })).toThrow(/idle deadline/);
    expect(() => duels.markReady(editing.slug, "g", guest)).toThrow(/idle deadline/);
    expect(() => duels.markUnready(editing.slug, "g", guest)).toThrow(/idle deadline/);
    expect(() => duels.takeSeat(editing.slug, "g", guest, 2)).toThrow(/idle deadline/);
    expect(() => duels.addPracticeBot(editing.slug, "g", playerId, { main: Array(40).fill(1), extra: [], side: [], deckMaster: 2 })).toThrow(/idle deadline/);
    expect(duels.expireWaitingTables(Date.now(), 10).map(row => row.slug)).toEqual([editing.slug]);
    expect(activityFetch).toHaveBeenCalledTimes(inputs);
    expect((await activityPost(inputRequest(), context)).status).toBe(409);
    expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
  } finally { cleanup(); db.close(); }
});
