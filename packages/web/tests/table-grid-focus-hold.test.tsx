// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useGridFocus, type UseGridFocusOptions } from "@/components/duel/table/grid-focus";

afterEach(cleanup);

const base: UseGridFocusOptions = { enabled: true, shown: [0, 1, 2, 3], suspended: false, digitsFree: true, escapeFree: true };

describe("useGridFocus when the focused seat goes out", () => {
  it("shows all fields at once when the seat is not held (it never zooms in by itself)", () => {
    const { result, rerender } = renderHook((props: UseGridFocusOptions) => useGridFocus(props), { initialProps: base });
    act(() => result.current.focusSeat(2));
    expect(result.current.focus.seat).toBe(2);
    rerender({ ...base, shown: [0, 1, 3] });
    expect(result.current.focus.seat).toBeNull();
  });

  it("keeps the focus on a held seat (its crumble plays) and shows all fields when the hold ends", () => {
    const { result, rerender } = renderHook((props: UseGridFocusOptions) => useGridFocus(props), { initialProps: base });
    act(() => result.current.focusSeat(2));
    rerender({ ...base, shown: [0, 1, 3], holding: [2] });
    expect(result.current.focus.seat).toBe(2);
    rerender({ ...base, shown: [0, 1, 3], holding: [2] });
    expect(result.current.focus.seat).toBe(2);
    rerender({ ...base, shown: [0, 1, 3], holding: [] });
    expect(result.current.focus.seat).toBeNull();
  });

  it("shows all fields when the home field is gone too", () => {
    const { result, rerender } = renderHook((props: UseGridFocusOptions) => useGridFocus(props), { initialProps: base });
    act(() => result.current.focusSeat(2));
    rerender({ ...base, shown: [1, 3] });
    expect(result.current.focus.seat).toBeNull();
  });

  it("holds through hold(): the focus stays while the stage says the seat crumbles, and shows all fields when it says no more", () => {
    const { result, rerender } = renderHook((props: UseGridFocusOptions) => useGridFocus(props), { initialProps: base });
    act(() => result.current.focusSeat(2));
    act(() => result.current.hold([2]));
    rerender({ ...base, shown: [0, 1, 3] });
    expect(result.current.focus.seat).toBe(2);
    act(() => result.current.hold([]));
    expect(result.current.focus.seat).toBeNull();
  });
});
