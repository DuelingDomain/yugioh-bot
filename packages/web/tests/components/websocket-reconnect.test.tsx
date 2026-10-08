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

function mockTournamentConnection() {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ token: "tournament-token", userId: 101 }) });
  vi.stubGlobal("fetch", mockFetch);
}

function acknowledgeTournamentJoin(index = 0) {
  act(() => sockets[index].emit.mock.lastCall![2]({}));
}

describe.each([
  { room: "tournament", useSocket: (slug: string, refetch: () => void) => useTournamentWebsocket(slug, { onMatchUpdated: refetch }) },
])("$room reconnect", ({ room, useSocket }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    sockets.length = 0;
    mockTournamentConnection();
  });

  afterEach(() => vi.unstubAllGlobals());

  async function connect(index = 0) {
    const joins = sockets[index].emit.mock.calls.length;
    act(() => sockets[index].handlers.get("connect")!());
    await waitFor(() => expect(sockets[index].emit).toHaveBeenCalledTimes(joins + 1));
  }

  it("joins on first connect without refetching", async () => {
    const refetch = vi.fn();
    renderHook(() => useSocket("cup", refetch));
    await connect();
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith("/api/tournaments/cup/connection", expect.objectContaining({ cache: "no-store" }));
    expect(sockets[0].emit).toHaveBeenCalledExactlyOnceWith(`${room}:join`, {
      slug: "cup", token: "tournament-token", userId: 101,
    }, expect.any(Function));
    expect(refetch).not.toHaveBeenCalled();
    acknowledgeTournamentJoin();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("refetches exactly once for each reconnect after rejoining", async () => {
    const refetch = vi.fn(() => {
      expect(sockets[0].emit).toHaveBeenLastCalledWith(`${room}:join`, {
        slug: "cup", token: "tournament-token", userId: 101,
      }, expect.any(Function));
    });
    renderHook(() => useSocket("cup", refetch));
    await connect();
    acknowledgeTournamentJoin();
    await connect();
    expect(refetch).not.toHaveBeenCalled();
    acknowledgeTournamentJoin();
    expect(refetch).toHaveBeenCalledTimes(1);
    await connect();
    expect(refetch).toHaveBeenCalledTimes(1);
    acknowledgeTournamentJoin();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(sockets[0].emit).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("uses the current refetch callback without replacing the socket", async () => {
    const oldRefetch = vi.fn();
    const newRefetch = vi.fn();
    const { rerender } = renderHook(({ refetch }) => useSocket("cup", refetch), { initialProps: { refetch: oldRefetch } });
    await connect();
    acknowledgeTournamentJoin();
    rerender({ refetch: newRefetch });
    await connect();
    expect(newRefetch).not.toHaveBeenCalled();
    acknowledgeTournamentJoin();
    expect(oldRefetch).not.toHaveBeenCalled();
    expect(newRefetch).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledTimes(1);
  });

  it("treats a different slug as a new first connection", async () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(({ slug }) => useSocket(slug, refetch), { initialProps: { slug: "old" } });
    await connect();
    acknowledgeTournamentJoin();
    rerender({ slug: "new" });
    await connect(1);
    acknowledgeTournamentJoin(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/tournaments/new/connection", expect.objectContaining({ cache: "no-store" }));
    expect(sockets[1].emit).toHaveBeenCalledExactlyOnceWith(`${room}:join`, {
      slug: "new", token: "tournament-token", userId: 101,
    }, expect.any(Function));
    await connect(1);
    expect(refetch).not.toHaveBeenCalled();
    acknowledgeTournamentJoin(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("tournament onInvalidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sockets.length = 0;
    mockTournamentConnection();
  });

  afterEach(() => vi.unstubAllGlobals());

  const fire = (event: string, ...args: unknown[]) => act(() => sockets[0].handlers.get(event)!(...args));

  it("fires after each tournament event, after the specific callback", async () => {
    const calls: string[] = [];
    renderHook(() =>
      useTournamentWebsocket("cup", {
        onMatchUpdated: () => calls.push("match"),
        onCompleted: () => calls.push("completed"),
        onInvalidate: () => calls.push("invalidate"),
      }),
    );
    fire("connect");
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(1));
    acknowledgeTournamentJoin();
    fire("tournament:match-updated");
    fire("tournament:completed");
    expect(calls).toEqual(["match", "invalidate", "completed", "invalidate"]);
    for (const event of ["tournament:started", "tournament:cancelled", "tournament:participant-joined", "tournament:participant-left"]) {
      fire(event, { playerId: 1, displayName: "A" });
    }
    expect(calls.filter((c) => c === "invalidate")).toHaveLength(6);
  });

  it("fires on reconnect but not on the first connect", async () => {
    const onInvalidate = vi.fn();
    renderHook(() => useTournamentWebsocket("cup", { onInvalidate }));
    fire("connect");
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(1));
    acknowledgeTournamentJoin();
    expect(onInvalidate).not.toHaveBeenCalled();
    fire("connect");
    await waitFor(() => expect(sockets[0].emit).toHaveBeenCalledTimes(2));
    expect(onInvalidate).not.toHaveBeenCalled();
    acknowledgeTournamentJoin();
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(sockets[0].emit).toHaveBeenLastCalledWith("tournament:join", {
      slug: "cup", token: "tournament-token", userId: 101,
    }, expect.any(Function));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses the current callback without replacing the socket", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useTournamentWebsocket("cup", { onInvalidate: cb }), { initialProps: { cb: first } });
    rerender({ cb: second });
    fire("tournament:match-updated");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledTimes(1);
  });
});

describe("draft reconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sockets.length = 0;
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ token: "first-token", userId: 101 }) });
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
      slug: "cup", token: "first-token", userId: 101,
    }, expect.any(Function)));

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ token: "reconnected-token", userId: 101 }) });
    connect();
    await waitFor(() => expect(sockets[0].emit).toHaveBeenNthCalledWith(2, "draft:join", {
      slug: "cup", token: "reconnected-token", userId: 101,
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
        ok: true, json: async () => ({ token: "reconnected-token", userId: 101 }),
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
      slug: "old", token: "first-token", userId: 101,
    }, expect.any(Function)));
    act(() => sockets[0].emit.mock.calls[0][2]());
    expect(onResync).toHaveBeenCalledTimes(1);

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ token: "new-slug-token", userId: 101 }) });
    rerender({ slug: "new" });
    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledTimes(2);
    connect(1);
    await waitFor(() => expect(sockets[1].emit).toHaveBeenCalledExactlyOnceWith("draft:join", {
      slug: "new", token: "new-slug-token", userId: 101,
    }, expect.any(Function)));
    expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/drafts/new/connection", expect.objectContaining({ cache: "no-store" }));
    expect(onResync).toHaveBeenCalledTimes(1);
    act(() => sockets[1].emit.mock.calls[0][2]({}));
    expect(onResync).toHaveBeenCalledTimes(2);
  });

  describe("join retries", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("retries a token 500 after one second, joins, and resyncs after the acknowledgement", async () => {
      const onResync = vi.fn();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      renderHook(() => useDraftWebsocket("cup", { onResync }));
      await act(async () => connect());
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(sockets[0].emit).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(999); });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(sockets[0].emit).toHaveBeenCalledExactlyOnceWith("draft:join", {
        slug: "cup", token: "first-token", userId: 101,
      }, expect.any(Function));
      expect(onResync).not.toHaveBeenCalled();

      act(() => sockets[0].emit.mock.calls[0][2]({}));
      expect(onResync).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries a join acknowledgement error and resyncs only after a successful acknowledgement", async () => {
      const onResync = vi.fn();
      renderHook(() => useDraftWebsocket("cup", { onResync }));
      await act(async () => connect());
      act(() => sockets[0].emit.mock.calls[0][2]({ error: "Temporarily unavailable" }));
      expect(onResync).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(999); });
      expect(sockets[0].emit).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(sockets[0].emit).toHaveBeenCalledTimes(2);
      expect(onResync).not.toHaveBeenCalled();
      act(() => sockets[0].emit.mock.calls[1][2]({}));
      expect(onResync).toHaveBeenCalledTimes(1);
    });

    it.each([403, 404])("does not retry a token %i", async (status) => {
      mockFetch.mockResolvedValueOnce({ ok: false, status });
      renderHook(() => useDraftWebsocket("cup"));
      await act(async () => connect());
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(sockets[0].emit).not.toHaveBeenCalled();
    });

    it("cancels a pending retry on disconnect", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      renderHook(() => useDraftWebsocket("cup"));
      await act(async () => connect());
      expect(vi.getTimerCount()).toBe(1);

      act(() => sockets[0].handlers.get("disconnect")!());
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(sockets[0].emit).not.toHaveBeenCalled();
    });

    it("cancels a pending retry when a new join starts", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      renderHook(() => useDraftWebsocket("cup"));
      await act(async () => connect());
      expect(vi.getTimerCount()).toBe(1);

      await act(async () => connect());
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(sockets[0].emit).toHaveBeenCalledTimes(1);
    });

    it("retries a network error while the socket stays connected", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new TypeError("Network unavailable"));
      renderHook(() => useDraftWebsocket("cup"));
      await act(async () => connect());
      expect(sockets[0].emit).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(sockets[0].emit).toHaveBeenCalledTimes(1);
    });

    it("keeps retrying with a fifteen-second backoff cap until unmounted", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      const { unmount } = renderHook(() => useDraftWebsocket("cup"));
      await act(async () => connect());

      let attempts = 1;
      for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
        await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); });
        expect(mockFetch).toHaveBeenCalledTimes(attempts);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(mockFetch).toHaveBeenCalledTimes(++attempts);
        expect(vi.getTimerCount()).toBe(1);
      }

      unmount();
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(mockFetch).toHaveBeenCalledTimes(attempts);
    });
  });
});
