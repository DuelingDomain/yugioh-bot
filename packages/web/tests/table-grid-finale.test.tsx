// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTION_MS, CAPTION_TEXT, FINALE_BEAT_MS, finaleBoard, useGridFinale, type FinaleCell } from "@/components/duel/table/grid-finale";
import { EXIT_CRUMBLE_MS } from "@/components/duel/table/rival-field";

// Seat 0 is home (bottom left), 1 faces it (top left); 2 (top right) faces 3 (bottom right).
const cells: FinaleCell[] = [
  { seat: 0, column: 0, row: 1, home: true },
  { seat: 1, column: 0, row: 0, home: false },
  { seat: 2, column: 1, row: 0, home: false },
  { seat: 3, column: 1, row: 1, home: false },
];
const seatsOut = (out: number[]) => [0, 1, 2, 3].map((seat) => ({ seat, eliminated: out.includes(seat) }));

describe("finaleBoard", () => {
  it("is 'same' for two seats of one pair and 'cross' for two of different pairs", () => {
    expect(finaleBoard([0, 1], cells)).toEqual({ kind: "same", bottom: 0, top: 1 });
    expect(finaleBoard([2, 3], cells)).toEqual({ kind: "same", bottom: 3, top: 2 });
    expect(finaleBoard([0, 2], cells)).toEqual({ kind: "cross", bottom: 0, top: 2 });
    expect(finaleBoard([1, 3], cells)).toEqual({ kind: "cross", bottom: 3, top: 1 });
  });

  it("puts the home seat at the bottom, even when it sits on the top row", () => {
    const top = cells.map((cell) => (cell.seat === 1 ? { ...cell, home: true } : { ...cell, home: false }));
    expect(finaleBoard([1, 3], top)).toEqual({ kind: "cross", bottom: 1, top: 3 });
  });

  it("puts the seat of the home column at the bottom when both are on one row and neither is home", () => {
    expect(finaleBoard([1, 2], cells)).toEqual({ kind: "cross", bottom: 1, top: 2 });
  });

  it("is null for any other number of seats", () => {
    expect(finaleBoard([0, 1, 2], cells)).toBeNull();
    expect(finaleBoard([0], cells)).toBeNull();
    expect(finaleBoard([], cells)).toBeNull();
  });
});

describe("useGridFinale", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const run = (initial: number[], reducedMotion = false) =>
    renderHook(({ out }) => useGridFinale({ seats: seatsOut(out), cells, reducedMotion }), { initialProps: { out: initial } });

  it("shows the board after the crumble and a beat, with the FINAL DUEL caption, then drops the caption", () => {
    const hook = run([2]);
    hook.rerender({ out: [2, 3] });
    expect(hook.result.current).toEqual({ board: null, caption: null });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS - 1));
    expect(hook.result.current.board).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(hook.result.current.board).toEqual({ kind: "same", bottom: 0, top: 1 });
    expect(hook.result.current.caption).toMatchObject({ kind: "same", seats: [0, 1] });
    expect(CAPTION_TEXT).toBe("FINAL DUEL");
    act(() => void vi.advanceTimersByTime(CAPTION_MS));
    expect(hook.result.current.caption).toBeNull();
    expect(hook.result.current.board).toEqual({ kind: "same", bottom: 0, top: 1 });
  });

  it("also shows the board when the two left are of different pairs", () => {
    const hook = run([2]);
    hook.rerender({ out: [1, 2] });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS));
    expect(hook.result.current.board).toEqual({ kind: "cross", bottom: 0, top: 3 });
    expect(hook.result.current.caption).toMatchObject({ kind: "cross", seats: [0, 3] });
  });

  it("keeps the board when one of the last two goes out, so the loser crumbles on it", () => {
    const hook = run([2, 3]);
    hook.rerender({ out: [1, 2, 3] });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS + FINALE_BEAT_MS));
    expect(hook.result.current.board).toEqual({ kind: "same", bottom: 0, top: 1 });
  });

  it("drops the board when more than two seats are live again (a new duel)", () => {
    const hook = run([2, 3]);
    hook.rerender({ out: [] });
    act(() => void vi.advanceTimersByTime(0));
    expect(hook.result.current).toEqual({ board: null, caption: null });
  });

  it("swaps the layout at once with reduced motion", () => {
    const hook = run([2], true);
    hook.rerender({ out: [2, 3] });
    act(() => void vi.advanceTimersByTime(0));
    expect(hook.result.current.board?.kind).toBe("same");
  });

  it("still starts the finale when reduced motion changes during the wait", () => {
    const hook = renderHook(({ out, reducedMotion }) => useGridFinale({ seats: seatsOut(out), cells, reducedMotion }), {
      initialProps: { out: [2], reducedMotion: false },
    });
    hook.rerender({ out: [2, 3], reducedMotion: false });
    act(() => void vi.advanceTimersByTime(EXIT_CRUMBLE_MS));
    expect(hook.result.current.board).toBeNull();
    hook.rerender({ out: [2, 3], reducedMotion: true });
    act(() => void vi.advanceTimersByTime(0));
    expect(hook.result.current.board?.kind).toBe("same");
    expect(hook.result.current.caption?.kind).toBe("same");
  });

  it("opens straight on the finale board, with no caption, when two seats are already left", () => {
    const hook = run([1, 2]);
    expect(hook.result.current).toEqual({ board: { kind: "cross", bottom: 0, top: 3 }, caption: null });
  });
});
