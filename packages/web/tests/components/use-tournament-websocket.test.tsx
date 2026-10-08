// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useTournamentWebsocket } from "../../src/lib/hooks/use-tournament-websocket";
const handlers: Record<string, (...args: any[]) => void> = {};
const socket = { connected: true, on: (event: string, handler: (...args: any[]) => void) => { handlers[event] = handler; }, emit: vi.fn(), disconnect: vi.fn() };
const fetchToken = vi.fn();
vi.mock("socket.io-client", () => ({ io: () => socket }));
function Harness({ onMatchUpdated, onInvalidate }: { onMatchUpdated?: () => void; onInvalidate?: () => void }) {
  useTournamentWebsocket("my cup", { onMatchUpdated, onInvalidate });
  return null;
}
describe("tournament authorized live feed", () => {
  beforeEach(() => {
    vi.clearAllMocks(); socket.connected = true;
    for (const event of Object.keys(handlers)) delete handlers[event];
    fetchToken.mockReset();
    fetchToken.mockResolvedValue({ ok: true, json: async () => ({ token: "fresh", userId: 101 }) });
    vi.stubGlobal("fetch", fetchToken);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("fetches a token before joining and refreshes on reconnect, invalidating only after acknowledgement", async () => {
    const onInvalidate = vi.fn(); render(<Harness onInvalidate={onInvalidate} />);
    act(() => handlers.connect());
    await waitFor(() => expect(socket.emit).toHaveBeenCalledWith("tournament:join", { slug: "my cup", token: "fresh", userId: 101 }, expect.any(Function)));
    expect(fetchToken).toHaveBeenCalledWith("/api/tournaments/my%20cup/connection", expect.objectContaining({ cache: "no-store" }));
    act(() => socket.emit.mock.calls[0][2]());
    expect(onInvalidate).not.toHaveBeenCalled();
    fetchToken.mockResolvedValue({ ok: true, json: async () => ({ token: "renewed", userId: 101 }) });
    act(() => handlers.disconnect());
    act(() => handlers.connect());
    await waitFor(() => expect(socket.emit).toHaveBeenLastCalledWith("tournament:join", { slug: "my cup", token: "renewed", userId: 101 }, expect.any(Function)));
    expect(onInvalidate).not.toHaveBeenCalled();
    act(() => socket.emit.mock.calls[1][2]());
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });
  it("does not join after the token endpoint denies access", async () => {
    fetchToken.mockResolvedValue({ ok: false, status: 404 }); render(<Harness />);
    await act(async () => handlers.connect());
    expect(socket.emit).not.toHaveBeenCalled();
  });
  it("discards pending tokens on disconnect and unmount", async () => {
    let resolve!: (value: unknown) => void;
    fetchToken.mockReturnValue(new Promise(r => { resolve = r; }));
    const { unmount } = render(<Harness />);
    act(() => handlers.connect()); act(() => handlers.disconnect()); unmount();
    await act(async () => resolve({ ok: true, json: async () => ({ token: "old", userId: 101 }) }));
    expect(socket.emit).not.toHaveBeenCalled();
  });
  it("refetches when a subscription is revoked", async () => {
    const onInvalidate = vi.fn(); render(<Harness onInvalidate={onInvalidate} />);
    act(() => handlers.connect());
    await waitFor(() => expect(socket.emit).toHaveBeenCalledTimes(1));
    act(() => handlers["tournament:subscription-expired"]({ slug: "my cup" }));
    await waitFor(() => expect(socket.emit).toHaveBeenCalledTimes(2));
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  describe("initial join recovery", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it.each(["token failure", "network failure", "rejected acknowledgement"])(
      "refetches after the first successful acknowledgement following a %s",
      async (failure) => {
        const calls: string[] = [];
        if (failure === "token failure") fetchToken.mockResolvedValueOnce({ ok: false, status: 500 });
        if (failure === "network failure") {
          vi.spyOn(console, "warn").mockImplementation(() => {});
          fetchToken.mockRejectedValueOnce(new TypeError("Network unavailable"));
        }
        render(<Harness onMatchUpdated={() => calls.push("match")} onInvalidate={() => calls.push("invalidate")} />);
        await act(async () => handlers.connect());
        if (failure === "rejected acknowledgement") {
          act(() => socket.emit.mock.lastCall![2]({ error: "Token expired" }));
        }
        expect(calls).toEqual([]);
        expect(fetchToken).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(999); });
        expect(fetchToken).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(fetchToken).toHaveBeenCalledTimes(2);
        expect(socket.emit).toHaveBeenCalledTimes(failure === "rejected acknowledgement" ? 2 : 1);
        expect(calls).toEqual([]);
        act(() => socket.emit.mock.lastCall![2]({}));
        expect(calls).toEqual(["match", "invalidate"]);
        await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
        expect(fetchToken).toHaveBeenCalledTimes(2);
      },
    );

    it.each([401, 403, 404])("stops retrying when the token endpoint returns %s", async (status) => {
      const onInvalidate = vi.fn();
      fetchToken.mockResolvedValue({ ok: false, status });
      render(<Harness onInvalidate={onInvalidate} />);
      await act(async () => handlers.connect());
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(fetchToken).toHaveBeenCalledTimes(1);
      expect(socket.emit).not.toHaveBeenCalled();
      expect(onInvalidate).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      ["token", "disconnect"],
      ["acknowledgement", "disconnect"],
      ["token", "new connect"],
      ["acknowledgement", "new connect"],
    ])("refetches after an initial %s is interrupted by a %s and ignores the stale result", async (pending, interruption) => {
      let resolveToken!: (value: unknown) => void;
      const onInvalidate = vi.fn();
      const onMatchUpdated = vi.fn();
      if (pending === "token") fetchToken.mockReturnValueOnce(new Promise(resolve => { resolveToken = resolve; }));
      render(<Harness onMatchUpdated={onMatchUpdated} onInvalidate={onInvalidate} />);
      await act(async () => handlers.connect());
      const staleAck = socket.emit.mock.lastCall?.[2];
      if (interruption === "disconnect") {
        socket.connected = false;
        act(() => handlers.disconnect());
        socket.connected = true;
      }
      await act(async () => handlers.connect());
      expect(fetchToken.mock.calls[0][1].signal.aborted).toBe(true);
      const successfulJoins = pending === "token" ? 1 : 2;
      expect(socket.emit).toHaveBeenCalledTimes(successfulJoins);
      if (pending === "token") {
        await act(async () => resolveToken({ ok: true, json: async () => ({ token: "stale", userId: 101 }) }));
      } else {
        act(() => staleAck({ error: "Stale rejection" }));
        act(() => staleAck({}));
      }
      expect(socket.emit).toHaveBeenCalledTimes(successfulJoins);
      expect(onMatchUpdated).not.toHaveBeenCalled();
      expect(onInvalidate).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      act(() => socket.emit.mock.lastCall![2]({}));
      expect(onMatchUpdated).toHaveBeenCalledTimes(1);
      expect(onInvalidate).toHaveBeenCalledTimes(1);
    });

    it("uses current callbacks when the retry acknowledgement arrives", async () => {
      const oldMatchUpdated = vi.fn();
      const oldInvalidate = vi.fn();
      const newMatchUpdated = vi.fn();
      const newInvalidate = vi.fn();
      fetchToken.mockResolvedValueOnce({ ok: false, status: 500 });
      const { rerender } = render(<Harness onMatchUpdated={oldMatchUpdated} onInvalidate={oldInvalidate} />);
      await act(async () => handlers.connect());
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      rerender(<Harness onMatchUpdated={newMatchUpdated} onInvalidate={newInvalidate} />);
      expect(newMatchUpdated).not.toHaveBeenCalled();
      expect(newInvalidate).not.toHaveBeenCalled();
      act(() => socket.emit.mock.lastCall![2]({}));
      expect(oldMatchUpdated).not.toHaveBeenCalled();
      expect(oldInvalidate).not.toHaveBeenCalled();
      expect(newMatchUpdated).toHaveBeenCalledTimes(1);
      expect(newInvalidate).toHaveBeenCalledTimes(1);
    });

    it("stops an existing retry sequence once the user is signed out", async () => {
      fetchToken.mockResolvedValueOnce({ ok: false, status: 500 });
      fetchToken.mockResolvedValue({ ok: false, status: 401 });
      render(<Harness />);
      await act(async () => handlers.connect());
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(fetchToken).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(fetchToken).toHaveBeenCalledTimes(2);
      expect(socket.emit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["disconnect", "unmount"])("cancels the scheduled retry on %s", async (cancellation) => {
      fetchToken.mockResolvedValueOnce({ ok: false, status: 500 });
      const { unmount } = render(<Harness />);
      await act(async () => handlers.connect());
      expect(vi.getTimerCount()).toBe(1);
      if (cancellation === "disconnect") {
        socket.connected = false;
        act(() => handlers.disconnect());
      } else {
        unmount();
      }
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(fetchToken).toHaveBeenCalledTimes(1);
      expect(socket.emit).not.toHaveBeenCalled();
    });

    it.each(["disconnect", "unmount"])("ignores a recovered join acknowledgement after %s", async (cancellation) => {
      const onMatchUpdated = vi.fn();
      const onInvalidate = vi.fn();
      fetchToken.mockResolvedValueOnce({ ok: false, status: 500 });
      const { unmount } = render(<Harness onMatchUpdated={onMatchUpdated} onInvalidate={onInvalidate} />);
      await act(async () => handlers.connect());
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(socket.emit).toHaveBeenCalledTimes(1);
      if (cancellation === "disconnect") {
        socket.connected = false;
        act(() => handlers.disconnect());
      } else {
        unmount();
      }
      act(() => socket.emit.mock.lastCall![2]({}));
      act(() => socket.emit.mock.lastCall![2]({ error: "Late rejection" }));
      expect(onMatchUpdated).not.toHaveBeenCalled();
      expect(onInvalidate).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(fetchToken).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
