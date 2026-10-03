// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftWebsocket } from "../../src/lib/hooks/use-draft-websocket";
import { useTournamentWebsocket } from "../../src/lib/hooks/use-tournament-websocket";

const { sockets, io } = vi.hoisted(() => {
  const sockets: Array<{
    connected: boolean;
    handlers: Map<string, (...args: any[]) => void>;
    emit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    sockets,
    io: vi.fn(() => {
      const socket = { connected: true, handlers: new Map(), emit: vi.fn(), disconnect: vi.fn() };
      sockets.push(socket);
      return { ...socket, on: (event: string, handler: () => void) => socket.handlers.set(event, handler) };
    }),
  };
});

vi.mock("socket.io-client", () => ({ io }));

const mockFetch = vi.fn();

describe.each([
  { room: "tournament", useSocket: (slug: string, refetch: () => void) => useTournamentWebsocket(slug, { onMatchUpdated: refetch }) },
])("$room reconnect", ({ room, useSocket }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    sockets.length = 0;
  });

  function connect(index = 0) {
    act(() => sockets[index].handlers.get("connect")!());
  }

  it("joins on first connect without refetching", () => {
    const refetch = vi.fn();
    renderHook(() => useSocket("cup", refetch));
    connect();
    expect(sockets[0].emit).toHaveBeenCalledExactlyOnceWith(`${room}:join`, { slug: "cup" });
    expect(refetch).not.toHaveBeenCalled();
  });

  it("refetches exactly once for each reconnect after rejoining", () => {
    const refetch = vi.fn(() => {
      expect(sockets[0].emit).toHaveBeenLastCalledWith(`${room}:join`, { slug: "cup" });
    });
    renderHook(() => useSocket("cup", refetch));
    connect();
    connect();
    expect(refetch).toHaveBeenCalledTimes(1);
    connect();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(sockets[0].emit).toHaveBeenCalledTimes(3);
  });

  it("uses the current refetch callback without replacing the socket", () => {
    const oldRefetch = vi.fn();
    const newRefetch = vi.fn();
    const { rerender } = renderHook(({ refetch }) => useSocket("cup", refetch), { initialProps: { refetch: oldRefetch } });
    connect();
    rerender({ refetch: newRefetch });
    connect();
    expect(oldRefetch).not.toHaveBeenCalled();
    expect(newRefetch).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledTimes(1);
  });

  it("treats a different slug as a new first connection", () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(({ slug }) => useSocket(slug, refetch), { initialProps: { slug: "old" } });
    connect();
    rerender({ slug: "new" });
    connect(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    expect(sockets[1].emit).toHaveBeenCalledExactlyOnceWith(`${room}:join`, { slug: "new" });
    connect(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("draft reconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sockets.length = 0;
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ token: "first-token", userId: "user-1" }) });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function connect(index = 0) {
    act(() => sockets[index].handlers.get("connect")!());
  }

  it("fetches a fresh token and joins with an acknowledgement on reconnect", async () => {
    renderHook(() => useDraftWebsocket("cup"));
    connect();
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledExactlyOnceWith("draft:join", {
      slug: "cup", token: "first-token", userId: "user-1",
    }, expect.any(Function)));

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ token: "reconnected-token", userId: "user-1" }) });
    connect();
    await waitFor(() => expect(sockets[0].emit).toHaveBeenNthCalledWith(2, "draft:join", {
      slug: "cup", token: "reconnected-token", userId: "user-1",
    }, expect.any(Function)));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/drafts/cup/connection", expect.objectContaining({ cache: "no-store" }));
    expect(sockets[0].emit).toHaveBeenCalledTimes(2);
  });

  it("resyncs once after each successful join acknowledgement, including the first, and skips refused joins", async () => {
    const onResync = vi.fn();
    renderHook(() => useDraftWebsocket("cup", { onResync }));

    for (let join = 0; join < 3; join++) {
      connect();
      await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(join + 1));
      expect(onResync).toHaveBeenCalledTimes(join);
      act(() => sockets[0].emit.mock.calls[join][2]());
      expect(onResync).toHaveBeenCalledTimes(join + 1);
    }

    connect();
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(4));
    expect(onResync).toHaveBeenCalledTimes(3);
    act(() => sockets[0].emit.mock.calls[3][2]({ error: "Access denied" }));
    expect(onResync).toHaveBeenCalledTimes(3);

    connect();
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(5));
    expect(onResync).toHaveBeenCalledTimes(3);
    act(() => sockets[0].emit.mock.calls[4][2]({}));
    expect(onResync).toHaveBeenCalledTimes(4);
  });

  it("ignores an earlier acknowledgement as soon as a newer connect starts", async () => {
    const onResync = vi.fn();
    renderHook(() => useDraftWebsocket("cup", { onResync }));
    connect();
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(1));
    const staleAck: (result?: { error?: string }) => void = sockets[0].emit.mock.calls[0][2];

    let resolveReconnect!: () => void;
    mockFetch.mockReturnValueOnce(new Promise((resolve) => {
      resolveReconnect = () => resolve({
        ok: true, json: async () => ({ token: "reconnected-token", userId: "user-1" }),
      });
    }));
    connect();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sockets[0].emit).toHaveBeenCalledTimes(1);
    act(() => staleAck());
    expect(onResync).not.toHaveBeenCalled();

    await act(async () => resolveReconnect());
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(2));
    act(() => sockets[0].emit.mock.calls[1][2]({}));
    expect(onResync).toHaveBeenCalledTimes(1);
    act(() => staleAck());
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("uses the current resync callback for pending and reconnect acknowledgements without replacing the socket", async () => {
    const oldResync = vi.fn();
    const newResync = vi.fn();
    const { rerender } = renderHook(({ onResync }) => useDraftWebsocket("cup", { onResync }), {
      initialProps: { onResync: oldResync },
    });
    connect();
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(1));

    rerender({ onResync: newResync });
    expect(newResync).not.toHaveBeenCalled();
    act(() => sockets[0].emit.mock.calls[0][2]());
    expect(oldResync).not.toHaveBeenCalled();
    expect(newResync).toHaveBeenCalledTimes(1);

    connect();
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(2));
    expect(newResync).toHaveBeenCalledTimes(1);
    act(() => sockets[0].emit.mock.calls[1][2]({}));
    expect(oldResync).not.toHaveBeenCalled();
    expect(newResync).toHaveBeenCalledTimes(2);
    expect(io).toHaveBeenCalledTimes(1);
  });

  it("disconnects the old socket and joins the new slug after a slug change", async () => {
    const onResync = vi.fn();
    const { rerender } = renderHook(({ slug }) => useDraftWebsocket(slug, { onResync }), {
      initialProps: { slug: "old" },
    });
    connect();
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledExactlyOnceWith("draft:join", {
      slug: "old", token: "first-token", userId: "user-1",
    }, expect.any(Function)));
    act(() => sockets[0].emit.mock.calls[0][2]());
    expect(onResync).toHaveBeenCalledTimes(1);

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ token: "new-slug-token", userId: "user-1" }) });
    rerender({ slug: "new" });
    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledTimes(2);
    connect(1);
    await waitFor(() => expect(sockets[1].emit).toHaveBeenCalledExactlyOnceWith("draft:join", {
      slug: "new", token: "new-slug-token", userId: "user-1",
    }, expect.any(Function)));
    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/drafts/new/connection", expect.objectContaining({ cache: "no-store" }));
    expect(onResync).toHaveBeenCalledTimes(1);
    act(() => sockets[1].emit.mock.calls[0][2]({}));
    expect(onResync).toHaveBeenCalledTimes(2);
  });
});
