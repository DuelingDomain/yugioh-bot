// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { LOBBY_COUNTDOWN_POLL_MS, LOBBY_IDLE_POLL_MS, type LobbySnapshot } from "@yugidraft/shared/types";
import { useLobbyClock, type LobbyClock } from "../../src/lib/hooks/use-lobby-clock";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function lobby(over: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    revision: 1,
    serverNow: new Date(NOW).toISOString(),
    targetSeats: 4,
    joined: 2,
    ready: 1,
    allReady: false,
    autoStart: { enabled: true, held: false, eligible: false },
    start: null,
    errors: [],
    warnings: [],
    lastStartError: null,
    ...over,
  };
}

let clock: LobbyClock | null = null;

function Harness({ pending = true, snapshot, onRefresh }: { pending?: boolean; snapshot?: LobbySnapshot | null; onRefresh: () => void }) {
  clock = useLobbyClock({ pending, lobby: snapshot, onRefresh });
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
}

describe("useLobbyClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    clock = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads the draft every idle interval while nothing is scheduled", () => {
    const onRefresh = vi.fn();
    render(<Harness snapshot={lobby()} onRefresh={onRefresh} />);
    act(() => { vi.advanceTimersByTime(LOBBY_IDLE_POLL_MS - 1); });
    expect(onRefresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(LOBBY_IDLE_POLL_MS * 2); });
    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it("reads every second while a start is scheduled and once just after its deadline", () => {
    const onRefresh = vi.fn();
    const start = { token: "t", kind: "auto" as const, startsAt: new Date(NOW + 2_500).toISOString() };
    render(<Harness snapshot={lobby({ start })} onRefresh={onRefresh} />);
    expect(clock?.counting).toBe(true);
    act(() => { vi.advanceTimersByTime(LOBBY_COUNTDOWN_POLL_MS); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(LOBBY_COUNTDOWN_POLL_MS); });
    expect(onRefresh).toHaveBeenCalledTimes(2);
    // 2.5 s deadline + 250 ms grace = 2.75 s: one extra read between the 2 s and 3 s ticks.
    act(() => { vi.advanceTimersByTime(750); });
    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it("measures the deadline on the server clock when the browser clock is wrong", () => {
    const onRefresh = vi.fn();
    // The browser is 1 hour ahead of the server. The server says the start is 1.5 s away.
    vi.setSystemTime(NOW + 3_600_000);
    const start = { token: "t", kind: "manual" as const, startsAt: new Date(NOW + 1_500).toISOString() };
    render(<Harness snapshot={lobby({ start })} onRefresh={onRefresh} />);
    expect(clock?.offsetMs).toBe(-3_600_000);
    expect(clock?.serverNow()).toBe(NOW);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // 1.5 s + 250 ms grace: the deadline read lands at 1.75 s on the server clock, not at once.
    act(() => { vi.advanceTimersByTime(750); });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("returns to the idle interval once the start clears", () => {
    const onRefresh = vi.fn();
    const start = { token: "t", kind: "auto" as const, startsAt: new Date(NOW + 60_000).toISOString() };
    const { rerender } = render(<Harness snapshot={lobby({ start })} onRefresh={onRefresh} />);
    act(() => { vi.advanceTimersByTime(LOBBY_COUNTDOWN_POLL_MS); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    rerender(<Harness snapshot={lobby({ revision: 2, start: null })} onRefresh={onRefresh} />);
    expect(clock?.counting).toBe(false);
    onRefresh.mockClear();
    act(() => { vi.advanceTimersByTime(LOBBY_IDLE_POLL_MS - 1); });
    expect(onRefresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not read while the tab is hidden", () => {
    const onRefresh = vi.fn();
    setVisibility("hidden");
    render(<Harness snapshot={lobby()} onRefresh={onRefresh} />);
    act(() => { vi.advanceTimersByTime(LOBBY_IDLE_POLL_MS * 3); });
    expect(onRefresh).not.toHaveBeenCalled();
    setVisibility("visible");
    act(() => { vi.advanceTimersByTime(LOBBY_IDLE_POLL_MS); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("is silent for a draft that is not pending, and stops on unmount", () => {
    const onRefresh = vi.fn();
    const { rerender, unmount } = render(<Harness pending={false} snapshot={null} onRefresh={onRefresh} />);
    act(() => { vi.advanceTimersByTime(LOBBY_IDLE_POLL_MS * 2); });
    expect(onRefresh).not.toHaveBeenCalled();
    rerender(<Harness pending snapshot={lobby()} onRefresh={onRefresh} />);
    act(() => { vi.advanceTimersByTime(LOBBY_IDLE_POLL_MS); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    unmount();
    act(() => { vi.advanceTimersByTime(LOBBY_IDLE_POLL_MS * 2); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("calls the newest refresh callback without restarting its timers", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness snapshot={lobby()} onRefresh={first} />);
    act(() => { vi.advanceTimersByTime(LOBBY_IDLE_POLL_MS - 1_000); });
    rerender(<Harness snapshot={lobby()} onRefresh={second} />);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
