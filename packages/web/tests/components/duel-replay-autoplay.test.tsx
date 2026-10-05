// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { useReplayAutoplay } from "@/components/duel/replay";
import { acquireCoinPlaying, resetCoinTossState } from "@/components/duel/coin-toss-lock";

beforeEach(() => { vi.useFakeTimers(); resetCoinTossState(); });
afterEach(() => { cleanup(); resetCoinTossState(); vi.useRealTimers(); });

describe("replay autoplay and the coin toss", () => {
  const options = (patch: Partial<Parameters<typeof useReplayAutoplay>[0]> = {}) => ({
    playing: true, index: 3, last: 10, speed: 1, setIndex: vi.fn(), setPlaying: vi.fn(), ...patch,
  });

  it("steps every 1.4 s when no coin plays", () => {
    const opts = options();
    renderHook(() => useReplayAutoplay(opts));
    act(() => { vi.advanceTimersByTime(1400); });
    expect(opts.setIndex).toHaveBeenCalledTimes(1);
  });

  it("does not step while a coin plays (even in the passive replay), and steps on after it", () => {
    const opts = options();
    const release = acquireCoinPlaying();
    renderHook(() => useReplayAutoplay(opts));
    act(() => { vi.advanceTimersByTime(11_000); });
    expect(opts.setIndex).not.toHaveBeenCalled();
    act(() => { release(); });
    act(() => { vi.advanceTimersByTime(1300); });
    expect(opts.setIndex).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(opts.setIndex).toHaveBeenCalledTimes(1);
  });

  it("a coin that starts right after a step cancels the step that was waiting", () => {
    const opts = options();
    renderHook(() => useReplayAutoplay(opts));
    act(() => { vi.advanceTimersByTime(1000); });
    let release = () => {};
    act(() => { release = acquireCoinPlaying(); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(opts.setIndex).not.toHaveBeenCalled();
    act(() => { release(); });
    act(() => { vi.advanceTimersByTime(1400); });
    expect(opts.setIndex).toHaveBeenCalledTimes(1);
  });

  it("stops playing at the last frame", () => {
    const opts = options({ index: 10 });
    renderHook(() => useReplayAutoplay(opts));
    expect(opts.setPlaying).toHaveBeenCalledWith(false);
  });
});
