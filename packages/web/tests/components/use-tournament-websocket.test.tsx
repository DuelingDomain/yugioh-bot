// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useTournamentWebsocket } from "../../src/lib/hooks/use-tournament-websocket";
const handlers: Record<string, (...args: any[]) => void> = {};
const socket = { connected: true, on: (event: string, handler: (...args: any[]) => void) => { handlers[event] = handler; }, emit: vi.fn(), disconnect: vi.fn() };
const fetchToken = vi.fn();
vi.mock("socket.io-client", () => ({ io: () => socket }));
function Harness({ onInvalidate }: { onInvalidate?: () => void }) { useTournamentWebsocket("my cup", { onInvalidate }); return null; }
describe("tournament authorized live feed", () => {
  beforeEach(() => {
    vi.clearAllMocks(); socket.connected = true;
    for (const event of Object.keys(handlers)) delete handlers[event];
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
});
