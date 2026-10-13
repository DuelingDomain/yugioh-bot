// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTION_MS, CAPTION_TEXT, FINALE_BEAT_MS, finalDuelSeats, useFinalDuelCaption } from "@/components/duel/table/final-duel-caption";
import { beginCrumbleWait } from "@/components/duel/table/crumble-gate";
import { EXIT_CRUMBLE_MS } from "@/components/duel/table/rival-field";

const seatsOut = (out: number[], count = 4) => Array.from({ length: count }, (_, seat) => ({ seat, eliminated: out.includes(seat) }));

describe("finalDuelSeats", () => {
  it("names the two live seats in seat order, the viewer first when it is one of them", () => {
    expect(finalDuelSeats([3, 0], null)).toEqual([0, 3]);
    expect(finalDuelSeats([0, 3], 3)).toEqual([3, 0]);
    expect(finalDuelSeats([0, 3], 0)).toEqual([0, 3]);
  });

  it("is null for any other number of seats", () => {
    expect(finalDuelSeats([0, 1, 2], null)).toBeNull();
    expect(finalDuelSeats([0], null)).toBeNull();
  });
});

describe("useFinalDuelCaption", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const run = (initial: number[], reducedMotion = false, count = 4) =>
    renderHook(({ out }) => useFinalDuelCaption({ seats: seatsOut(out, count), viewerSeat: null, reducedMotion }), { initialProps: { out: initial } });

  it("shows FINAL DUEL after the crumble and a beat, then drops it; no field moves", () => {
    const hook = run([2]);
    hook.rerender({ out: [2, 3] });
    expect(hook.result.current).toBeNull();
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS - 1));
    expect(hook.result.current).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(hook.result.current).toMatchObject({ seats: [0, 1] });
    expect(CAPTION_TEXT).toBe("FINAL DUEL");
    act(() => void vi.advanceTimersByTime(CAPTION_MS));
    expect(hook.result.current).toBeNull();
  });

  it("works for a 3-way table when one of three goes out", () => {
    const hook = run([], false, 3);
    hook.rerender({ out: [1] });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS));
    expect(hook.result.current).toMatchObject({ seats: [0, 2] });
  });

  it("counts the wait from the start of a crumble that waits for the battle", () => {
    const hook = run([2]);
    const startCrumble = beginCrumbleWait();
    hook.rerender({ out: [2, 3] });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS + 5000));
    expect(hook.result.current).toBeNull();
    act(() => startCrumble());
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS));
    expect(hook.result.current).toMatchObject({ seats: [0, 1] });
  });

  it("shows it at once with reduced motion", () => {
    const hook = run([2], true);
    hook.rerender({ out: [2, 3] });
    act(() => void vi.advanceTimersByTime(0));
    expect(hook.result.current).not.toBeNull();
  });

  it("shows no caption when the table opens with two seats left", () => {
    const hook = run([1, 2]);
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS + 100));
    expect(hook.result.current).toBeNull();
  });

  it("drops the caption when more than two seats are live again", () => {
    const hook = run([2, 3]);
    hook.rerender({ out: [] });
    act(() => void vi.advanceTimersByTime(0));
    expect(hook.result.current).toBeNull();
  });
});
