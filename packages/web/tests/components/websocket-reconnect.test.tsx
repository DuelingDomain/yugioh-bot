// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftWebsocket } from "../../src/lib/hooks/use-draft-websocket";
import { useTournamentWebsocket } from "../../src/lib/hooks/use-tournament-websocket";

const { sockets, io } = vi.hoisted(() => {
  const sockets: Array<{
    handlers: Map<string, (...args: any[]) => void>;
    emit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    sockets,
    io: vi.fn(() => {
      const socket = { handlers: new Map(), emit: vi.fn(), disconnect: vi.fn() };
      sockets.push(socket);
      return { ...socket, on: (event: string, handler: () => void) => socket.handlers.set(event, handler) };
    }),
  };
});

vi.mock("socket.io-client", () => ({ io }));

describe.each([
  { room: "draft", useSocket: (slug: string, refetch: () => void) => useDraftWebsocket(slug, { onResync: refetch }) },
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
