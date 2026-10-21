// @vitest-environment jsdom
import { createServer } from "node:http";
import { Server } from "socket.io";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, expect, it, vi } from "vitest";
import { useDuelWebsocket } from "../src/lib/hooks/use-duel-websocket";
import { useAdminSpectate } from "../src/lib/hooks/use-admin-spectate";
const target = vi.hoisted(() => ({ url: "" }));
vi.mock("socket.io-client", async original => {
  const client = await original<typeof import("socket.io-client")>();
  return { ...client, io: () => client.io(target.url, { transports: ["websocket"], forceNew: true }) };
});
afterEach(() => { vi.unstubAllGlobals(); });
it("coalesces eight real draft socket events and does not reload on token renewal", async () => {
  const server = createServer(); const io = new Server(server);
  io.on("connection", socket => socket.on("admin:spectate", (_request, ack) => ack({ ok: true })));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  target.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let snapshots = 0, connections = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/connection")) { connections++; return new Response(JSON.stringify({ token: "test", expiresAt: Date.now() + 16_000 })); }
    snapshots++; return new Response(JSON.stringify({ revision: snapshots }));
  }));
  const hook = renderHook(() => { const state = useAdminSpectate("draft", "draft-refresh", 12); return { data: state.data, error: state.error }; }, {
    wrapper: ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>,
  });
  try {
    await waitFor(() => expect(connections).toBe(1));
    await waitFor(() => { expect(hook.result.current.error).toBeUndefined(); expect(hook.result.current.data).toBeDefined(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    const before = snapshots;
    await act(async () => { for (let pick = 0; pick < 8; pick++) io.emit("draft:pick", { slug: "draft-refresh", playerId: pick });
      await new Promise(resolve => setTimeout(resolve, 200)); });
    expect(snapshots).toBe(before);
    await waitFor(() => expect(snapshots).toBe(before + 1));
    await waitFor(() => expect(connections).toBeGreaterThanOrEqual(2), { timeout: 2500 });
    expect(snapshots).toBe(before + 1);
  } finally { hook.unmount(); await new Promise<void>(resolve => io.close(() => resolve())); }
});

it("connects the real duel-board admin feed through the gated spectate connection route", async () => {
  const server = createServer(); const io = new Server(server); const playerEvents: string[] = [];
  let watched = false;
  io.on("connection", socket => {
    socket.onAny(event => { if (event.startsWith("duel:")) playerEvents.push(event); });
    socket.on("admin:spectate", (_request, ack) => { watched = true; ack({ ok: true }); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  target.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/admin/duels/admin-duel/spectate/connection"
    ? new Response(JSON.stringify({ token: "test", expiresAt: Date.now() + 60_000 })) : new Response("missing", { status: 404 })));
  const changed = vi.fn(async () => ({}));
  const hook = renderHook(() => useDuelWebsocket("admin-duel", null, changed, true, undefined, true));
  try {
    await waitFor(() => expect(hook.result.current.connected).toBe(true));
    expect(watched).toBe(true); expect(changed).toHaveBeenCalled(); expect(playerEvents).toEqual([]);
  } finally { hook.unmount(); await new Promise<void>(resolve => io.close(() => resolve())); }
});
