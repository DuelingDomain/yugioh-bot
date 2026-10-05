// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTION_MS, CAPTION_TEXT, FINALE_BEAT_MS, lastTwo, useGridFinale } from "@/components/duel/table/grid-finale";
import { EXIT_CRUMBLE_MS } from "@/components/duel/table/rival-field";

const columnOf = new Map<number, 0 | 1>([[0, 0], [1, 0], [2, 1], [3, 1]]);
const seatsOut = (out: number[]) => [0, 1, 2, 3].map((seat) => ({ seat, eliminated: out.includes(seat) }));

describe("lastTwo", () => {
  it("is the finale of a column when the two left face each other, else last-two", () => {
    expect(lastTwo([0, 1], columnOf)).toEqual({ kind: "final", column: 0 });
    expect(lastTwo([2, 3], columnOf)).toEqual({ kind: "final", column: 1 });
    expect(lastTwo([0, 2], columnOf)).toEqual({ kind: "last", column: null });
    expect(lastTwo([1, 3], columnOf)).toEqual({ kind: "last", column: null });
  });

  it("is null for any other number of seats", () => {
    expect(lastTwo([0, 1, 2], columnOf)).toBeNull();
    expect(lastTwo([0], columnOf)).toBeNull();
    expect(lastTwo([], columnOf)).toBeNull();
  });
});

describe("useGridFinale", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const run = (initial: number[], reducedMotion = false) =>
    renderHook(({ out }) => useGridFinale({ seats: seatsOut(out), columnOf, reducedMotion }), { initialProps: { out: initial } });

  it("grows the pair after the crumble and a beat, with the FINAL DUEL caption, then drops the caption", () => {
    const hook = run([2]);
    hook.rerender({ out: [2, 3] });
    expect(hook.result.current).toEqual({ column: null, caption: null });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS - 1));
    expect(hook.result.current.column).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(hook.result.current.column).toBe(0);
    expect(hook.result.current.caption?.kind).toBe("final");
    expect(CAPTION_TEXT.final).toBe("FINAL DUEL");
    act(() => void vi.advanceTimersByTime(CAPTION_MS));
    expect(hook.result.current.caption).toBeNull();
    expect(hook.result.current.column).toBe(0);
  });

  it("moves nothing when the two left are on different pairs, and says LAST TWO REMAINING", () => {
    const hook = run([2]);
    hook.rerender({ out: [1, 2] });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS));
    expect(hook.result.current.column).toBeNull();
    expect(hook.result.current.caption?.kind).toBe("last");
    expect(CAPTION_TEXT.last).toBe("LAST TWO REMAINING");
  });

  it("swaps the layout at once with reduced motion", () => {
    const hook = run([2], true);
    hook.rerender({ out: [2, 3] });
    act(() => void vi.advanceTimersByTime(0));
    expect(hook.result.current.column).toBe(0);
  });

  it("still starts the finale when reduced motion changes during the wait", () => {
    const hook = renderHook(({ out, reducedMotion }) => useGridFinale({ seats: seatsOut(out), columnOf, reducedMotion }), {
      initialProps: { out: [2], reducedMotion: false },
    });
    hook.rerender({ out: [2, 3], reducedMotion: false });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS));
    expect(hook.result.current.column).toBeNull();
    hook.rerender({ out: [2, 3], reducedMotion: true });
    act(() => void vi.advanceTimersByTime(0));
    expect(hook.result.current.column).toBe(0);
    expect(hook.result.current.caption?.kind).toBe("final");
  });

  it("opens straight on the finale board, with no caption, when two seats are already left", () => {
    const hook = run([2, 3]);
    expect(hook.result.current).toEqual({ column: 0, caption: null });
  });
});
