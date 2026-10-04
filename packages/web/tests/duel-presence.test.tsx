// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLiveNow } from "../src/components/layout/use-live-now";
import { useDuelWebsocket } from "../src/lib/hooks/use-duel-websocket";
import { useDuelPresence } from "../src/lib/hooks/use-duel-presence";

const sockets: FakeSocket[] = [];
class FakeSocket {
  connected = false;
  id = "first";
  handlers = new Map<string, (data?: any) => void>();
  emit = vi.fn();
  join = vi.fn((_event: string, _payload: unknown, ack: (error: Error | null, data: unknown) => void) => {
    ack(null, { ok: true, onlineSeats: [1], spectatorCount: 0 });
  });
  timeout() { return { emit: this.join }; }
  on(event: string, handler: (data?: any) => void) { this.handlers.set(event, handler); return this; }
  connect() { this.connected = true; queueMicrotask(() => this.handlers.get("connect")?.()); }
  disconnect() { this.connected = false; }
}
vi.mock("socket.io-client", () => ({ io: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } }));

function visibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
}
beforeEach(() => {
  sockets.length = 0;
  visibility("visible");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url === "/api/live"
    ? { yourDuel: { href: "/duels/alpha", state: "waiting", opponent: "Milan",
      opponents: [{ seat: 1, name: "Milan", isBot: false }] }, liveCount: 0 }
    : { token: "signed", guildId: "g1", expiresAt: Date.now() + 300_000 }))));
});
afterEach(() => { cleanup(); visibility("visible"); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("subscribes the sidebar as an observer and updates presence without polling it", async () => {
  const { result } = renderHook(() => useLiveNow("/dashboard"));
  await waitFor(() => expect(result.current?.presence?.onlineSeats).toEqual([1]));
  expect(sockets[0].join).toHaveBeenCalledWith("duel:join", { token: "signed", observe: true }, expect.any(Function));
  act(() => sockets[0].handlers.get("duel:presence")?.({ slug: "other", onlineSeats: [], spectatorCount: 0 }));
  expect(result.current?.presence?.onlineSeats).toEqual([1]);
  act(() => sockets[0].handlers.get("duel:presence")?.({ slug: "alpha", onlineSeats: [], spectatorCount: 0 }));
  expect(result.current?.presence?.onlineSeats).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
  act(() => {
    sockets[0].connected = false;
    sockets[0].handlers.get("disconnect")?.();
  });
  expect(result.current?.presence).toBeNull();
  act(() => { sockets[0].id = "reconnected"; sockets[0].connect(); });
  await waitFor(() => expect(result.current?.presence?.onlineSeats).toEqual([1]));
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("renews the sidebar token and clears presence when the subscription expires", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useLiveNow("/dashboard"));
  await act(async () => {});
  expect(result.current?.presence?.onlineSeats).toEqual([1]);
  await act(async () => { await vi.advanceTimersByTimeAsync(270_000); });
  expect(sockets[0].join).toHaveBeenCalledTimes(2);
  sockets[0].join.mockImplementationOnce((_event, _payload, ack) => ack(null, { ok: false, error: "expired" }));
  await act(async () => { sockets[0].handlers.get("duel:subscription-expired")?.({ slug: "alpha" }); });
  expect(result.current?.presence).toBeNull();
});

it("does not reuse an old snapshot when the same duel disappears and returns", async () => {
  const { result, rerender } = renderHook(({ slug }) => useDuelPresence(slug), {
    initialProps: { slug: "alpha" as string | null },
  });
  await waitFor(() => expect(result.current?.onlineSeats).toEqual([1]));
  rerender({ slug: null });
  expect(result.current).toBeNull();
  rerender({ slug: "alpha" });
  expect(result.current).toBeNull();
  await waitFor(() => expect(result.current?.onlineSeats).toEqual([1]));
});

it("rejoins after an offline/online transition even if Socket.IO still considers the transport connected", async () => {
  const { result } = renderHook(() => useLiveNow("/dashboard"));
  await waitFor(() => expect(result.current?.presence?.onlineSeats).toEqual([1]));
  act(() => window.dispatchEvent(new Event("offline")));
  expect(result.current?.presence).toBeNull();
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(result.current?.presence?.onlineSeats).toEqual([1]));
});

it("joins duel pages with their visibility and sends visibility changes over the existing socket", async () => {
  visibility("hidden");
  const view = renderHook(() => useDuelWebsocket("alpha", 0, async () => {}));
  await waitFor(() => expect(view.result.current.connected).toBe(true));
  expect(sockets[0].join).toHaveBeenCalledWith("duel:join", { token: "signed", visible: false }, expect.any(Function));
  visibility("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(sockets[0].emit).toHaveBeenCalledWith("duel:visibility", { visible: true });
  visibility("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(sockets[0].emit).toHaveBeenCalledWith("duel:visibility", { visible: false });
  const socket = sockets[0];
  view.unmount();
  expect(socket.emit).toHaveBeenCalledWith("duel:leave", { slug: "alpha", guildId: "g1" });
});
