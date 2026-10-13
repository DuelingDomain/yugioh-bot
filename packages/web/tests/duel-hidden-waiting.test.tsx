// @vitest-environment jsdom
import Database from "better-sqlite3";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

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
import { useDuelWebsocket } from "@/lib/hooks/use-duel-websocket";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("keeps a hidden host's private table alive past 15 minutes, then expires it after the tab closes", async () => {
  const db = new Database(":memory:"); migrate(db);
  const playerId = Number(db.prepare("insert into players(guild_id,discord_user_id,display_name) values('g',?,?)")
    .run("111111111111111111", "Host").lastInsertRowid);
  const duels = createDuelService(db);
  const table = duels.create({ guildId: "g", organizerPlayerId: playerId, name: "Private wait", mode: "normal", settings: { visibility: "private" } });
  mocks.actor.mockResolvedValue({ ok: true, guildId: "g", playerId, duels });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  vi.useFakeTimers();
  const fetchToken = vi.fn(() => GET(new Request(`http://localhost/api/duels/${table.slug}/connection`), { params: Promise.resolve({ slug: table.slug }) }));
  vi.stubGlobal("fetch", fetchToken);
  try {
    const view = renderHook(() => useDuelWebsocket(table.slug, 0, async () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.connected).toBe(true);
    for (let minute = 0; minute < 20; minute++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(duels.expireWaitingTables(Date.now(), 10)).toEqual([]);
    }
    expect(fetchToken.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(duels.get(table.slug, "g").status).toBe("lobby");
    view.unmount();
    const requests = fetchToken.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(16 * 60_000); });
    expect(fetchToken).toHaveBeenCalledTimes(requests);
    expect(duels.expireWaitingTables(Date.now(), 10).map(row => row.slug)).toEqual([table.slug]);
  } finally { cleanup(); db.close(); }
});
