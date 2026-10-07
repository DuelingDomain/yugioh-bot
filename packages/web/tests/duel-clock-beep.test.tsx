// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelClock } from "@yugidraft/shared/duels";
import { createLowClockWatcher, liveClockMs, ownClockSeat } from "@/components/duel/clock-beep";
import { DUEL_FX_CUE_EVENT, type DuelFxCueDetail } from "@/components/duel/event-queue";
import { PENDING_BEEP_MS, useLowClockBeep } from "@/components/duel/use-low-clock-beep";

function clockOf(remainingMs: number[], activeSeat: number | null = 0, serverNow = 1_000): DuelClock {
  return { turn: 1, remainingMs, activeSeat, startedAt: activeSeat == null ? null : serverNow, serverNow };
}

describe("createLowClockWatcher", () => {
  it("beeps once when the clock falls to one minute", () => {
    const watcher = createLowClockWatcher();
    expect(watcher.next(62_000, true)).toBe(false);
    expect(watcher.next(60_500, true)).toBe(false);
    expect(watcher.next(60_000, true)).toBe(true);
    expect(watcher.next(59_750, true)).toBe(false);
    expect(watcher.next(30_000, true)).toBe(false);
  });

  it("stays quiet when the first reading is already under one minute", () => {
    const watcher = createLowClockWatcher();
    expect(watcher.next(45_000, true)).toBe(false);
    expect(watcher.next(44_000, true)).toBe(false);
  });

  it("beeps again after a reset above one minute", () => {
    const watcher = createLowClockWatcher();
    watcher.next(70_000, true);
    expect(watcher.next(59_000, true)).toBe(true);
    expect(watcher.next(180_000, true)).toBe(false);
    expect(watcher.next(60_000, true)).toBe(true);
  });

  it("makes no sound when muted, and a late unmute does not catch up", () => {
    const watcher = createLowClockWatcher();
    watcher.next(70_000, false);
    expect(watcher.next(59_000, false)).toBe(false);
    expect(watcher.next(58_000, true)).toBe(false);
  });

  it("forgets the baseline when there is no own clock to watch", () => {
    const watcher = createLowClockWatcher();
    watcher.next(70_000, true);
    expect(watcher.next(null, true)).toBe(false);
    expect(watcher.next(50_000, true)).toBe(false);
  });
});

describe("ownClockSeat", () => {
  it("returns the viewer's seat only for a player", () => {
    expect(ownClockSeat({ mySeat: 1, spectator: false, replay: false })).toBe(1);
    expect(ownClockSeat({ mySeat: null, spectator: false, replay: false })).toBeNull();
    expect(ownClockSeat({ mySeat: undefined, spectator: false, replay: false })).toBeNull();
    expect(ownClockSeat({ mySeat: 0, spectator: true, replay: false })).toBeNull();
    expect(ownClockSeat({ mySeat: 0, spectator: false, replay: true })).toBeNull();
  });
});

describe("liveClockMs", () => {
  it("counts down only the answering seat", () => {
    const clock = clockOf([90_000, 90_000], 0, 1_000);
    expect(liveClockMs(clock, 0, 5_000)).toBe(85_000);
    expect(liveClockMs(clock, 1, 5_000)).toBe(90_000);
  });
});

describe("useLowClockBeep", () => {
  let cues: DuelFxCueDetail[];
  // Like the feedback layer: it takes the cue by calling preventDefault().
  const onCue = (event: Event) => {
    cues.push((event as CustomEvent<DuelFxCueDetail>).detail);
    event.preventDefault();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    cues = [];
    window.addEventListener(DUEL_FX_CUE_EVENT, onCue);
  });
  afterEach(() => {
    window.removeEventListener(DUEL_FX_CUE_EVENT, onCue);
    vi.useRealTimers();
  });

  it("beeps once when the own running clock reaches one minute", () => {
    renderHook(() => useLowClockBeep({ clock: clockOf([62_000, 200_000]), seat: 0, soundEnabled: true }));
    act(() => { vi.advanceTimersByTime(1_500); });
    expect(cues).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(cues).toEqual([{ cue: "clock-low", strength: 1 }]);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(cues).toHaveLength(1);
  });

  it("does not beep for the rival's clock", () => {
    renderHook(() => useLowClockBeep({ clock: clockOf([200_000, 61_000], 1), seat: 0, soundEnabled: true }));
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(cues).toHaveLength(0);
  });

  it("does not beep for a spectator or a replay (no seat)", () => {
    renderHook(() => useLowClockBeep({ clock: clockOf([61_000, 61_000]), seat: null, soundEnabled: true }));
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(cues).toHaveLength(0);
  });

  it("does not beep at load when the clock is already under one minute", () => {
    renderHook(() => useLowClockBeep({ clock: clockOf([40_000, 200_000]), seat: 0, soundEnabled: true }));
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(cues).toHaveLength(0);
  });

  it("makes no sound when sound is off", () => {
    renderHook(() => useLowClockBeep({ clock: clockOf([61_000, 200_000]), seat: 0, soundEnabled: false }));
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(cues).toHaveLength(0);
  });

  it("beeps again when a new snapshot resets the clock and it crosses again", () => {
    const { rerender } = renderHook((props: { clock: DuelClock }) => useLowClockBeep({ clock: props.clock, seat: 0, soundEnabled: true }),
      { initialProps: { clock: clockOf([61_000, 200_000], 0, 1_000) } });
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(cues).toHaveLength(1);
    rerender({ clock: clockOf([120_000, 200_000], 0, 9_000) });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(cues).toHaveLength(1);
    rerender({ clock: clockOf([59_000, 200_000], 0, 20_000) });
    expect(cues).toHaveLength(2);
  });
  it("keeps a crossing during recovery pending and beeps once the feedback layer is back", () => {
    // The feedback layer is unmounted (recovering): nobody takes the cue.
    window.removeEventListener(DUEL_FX_CUE_EVENT, onCue);
    const loose: DuelFxCueDetail[] = [];
    const looseListener = (event: Event) => loose.push((event as CustomEvent<DuelFxCueDetail>).detail);
    window.addEventListener(DUEL_FX_CUE_EVENT, looseListener);
    const { rerender } = renderHook((props: { clock: DuelClock }) => useLowClockBeep({ clock: props.clock, seat: 0, soundEnabled: true }),
      { initialProps: { clock: clockOf([120_000, 200_000], 0, 1_000) } });
    // A resync jumps the clock across 1:00 while nothing takes the cue.
    rerender({ clock: clockOf([55_000, 200_000], 0, 9_000) });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(loose.length).toBeGreaterThan(0);
    expect(cues).toHaveLength(0);
    // The layer mounts again and takes the cue: exactly one beep reaches it, then the retries stop.
    window.removeEventListener(DUEL_FX_CUE_EVENT, looseListener);
    window.addEventListener(DUEL_FX_CUE_EVENT, onCue);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(cues).toEqual([{ cue: "clock-low", strength: 1 }]);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(cues).toHaveLength(1);
  });

  it("drops a pending crossing that nobody took within the limit", () => {
    window.removeEventListener(DUEL_FX_CUE_EVENT, onCue);
    const { rerender } = renderHook((props: { clock: DuelClock }) => useLowClockBeep({ clock: props.clock, seat: 0, soundEnabled: true }),
      { initialProps: { clock: clockOf([120_000, 200_000], 0, 1_000) } });
    rerender({ clock: clockOf([55_000, 200_000], 0, 9_000) });
    act(() => { vi.advanceTimersByTime(PENDING_BEEP_MS + 2_000); });
    window.addEventListener(DUEL_FX_CUE_EVENT, onCue);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(cues).toHaveLength(0);
  });

  it("does not beep when the viewer's seat changes and the new seat's clock is already low", () => {
    const { rerender } = renderHook((props: { seat: number }) => useLowClockBeep({ clock: clockOf([200_000, 70_000], 1), seat: props.seat, soundEnabled: true }),
      { initialProps: { seat: 0 } });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(cues).toHaveLength(0);
    // Seat 1 has 70 s, so it falls to 60 s at once: the first reading of a new seat is only a baseline, a later one can cross.
    rerender({ seat: 1 });
    expect(cues).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(11_000); });
    expect(cues).toHaveLength(1);
  });
});
