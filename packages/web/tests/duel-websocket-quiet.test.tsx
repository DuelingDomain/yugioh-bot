// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const sockets: FakeSocket[] = [];

class FakeSocket {
  connected = false;
  id = "s1";
  handlers = new Map<string, (payload?: unknown) => void>();
  on(event: string, handler: (payload?: unknown) => void) { this.handlers.set(event, handler); return this; }
  timeout() {
    return {
      emit: (_event: string, _payload: unknown, ack: (error: Error | null, answer: unknown) => void) =>
        ack(null, { ok: true, onlineSeats: [0, 1], spectatorCount: 0 }),
    };
  }
  emit() {}
  connect() { this.connected = true; queueMicrotask(() => this.handlers.get("connect")?.()); }
  disconnect() { this.connected = false; }
}

vi.mock("socket.io-client", () => ({ io: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } }));

import { useDuelWebsocket } from "@/lib/hooks/use-duel-websocket";

type Gate = { promise: Promise<void>; open: () => void };
function gate(): Gate {
  let open = () => {};
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}

beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ guildId: "g1", token: "t", expiresAt: Date.now() + 300_000 }))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function connected(onChange: () => Promise<unknown>, quiet?: () => boolean) {
  const view = renderHook(() => useDuelWebsocket("duel-a", 0, onChange, false, quiet));
  await waitFor(() => expect(view.result.current.connected).toBe(true));
  await waitFor(() => expect(view.result.current.syncing).toBe(false));
  return view;
}

describe("useDuelWebsocket change notices", () => {
  it("raises the syncing flag while the room is re-read for a change notice", async () => {
    const read = gate();
    const onChange = vi.fn(async () => {});
    const { result } = await connected(onChange);
    onChange.mockImplementation(() => read.promise);
    act(() => sockets[0].handlers.get("duel:changed")?.({ slug: "duel-a", guildId: "g1" }));
    expect(result.current.syncing).toBe(true);
    await act(async () => { read.open(); await read.promise; });
    await waitFor(() => expect(result.current.syncing).toBe(false));
  });

  it("keeps the syncing flag down for the echo of the player's own answer, and still re-reads the room", async () => {
    const read = gate();
    const onChange = vi.fn(async () => {});
    const { result } = await connected(onChange, () => true);
    const before = onChange.mock.calls.length;
    onChange.mockImplementation(() => read.promise);
    act(() => sockets[0].handlers.get("duel:changed")?.({ slug: "duel-a", guildId: "g1" }));
    expect(onChange.mock.calls.length).toBe(before + 1);
    expect(result.current.syncing).toBe(false);
    await act(async () => { read.open(); await read.promise; });
    expect(result.current.syncing).toBe(false);
    expect(result.current.recovering).toBe(false);
  });

  it("an echo read that fails still raises the recovering flag", async () => {
    const onChange = vi.fn(async () => {});
    const { result } = await connected(onChange, () => true);
    onChange.mockImplementation(async () => { throw new Error("down"); });
    await act(async () => { sockets[0].handlers.get("duel:changed")?.({ slug: "duel-a", guildId: "g1" }); });
    await waitFor(() => expect(result.current.recovering).toBe(true));
  });

  it("asks quiet at the time of each notice", async () => {
    let quiet = true;
    const read = gate();
    const onChange = vi.fn(async () => {});
    const { result } = await connected(onChange, () => quiet);
    onChange.mockImplementation(() => read.promise);
    quiet = false;
    act(() => sockets[0].handlers.get("duel:changed")?.({ slug: "duel-a", guildId: "g1" }));
    expect(result.current.syncing).toBe(true);
    await act(async () => { read.open(); await read.promise; });
  });
});
