// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_VIEW_KEY, DEFAULT_BOARD_VIEW, readBoardView, useBoardView, writeBoardView } from "@/components/duel/board-view";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("board view setting", () => {
  it("is classic and tilted by default", () => {
    expect(readBoardView()).toEqual({ mode: "classic", tilt: "tilt" });
    expect(readBoardView()).toBe(DEFAULT_BOARD_VIEW);
  });

  it.each(["not json", "null", "5", '{"v":2,"mode":"3d","tilt":"flat"}', '{"v":1,"mode":"4d","tilt":"flat"}', '{"v":1,"mode":"3d","tilt":"up"}'])(
    "falls back to the default for %s", (raw) => {
      window.localStorage.setItem(BOARD_VIEW_KEY, raw);
      expect(readBoardView()).toBe(DEFAULT_BOARD_VIEW);
    });

  it("round trips and keeps the snapshot stable between writes", () => {
    writeBoardView({ mode: "3d", tilt: "flat" });
    expect(JSON.parse(window.localStorage.getItem(BOARD_VIEW_KEY)!)).toEqual({ v: 1, mode: "3d", tilt: "flat" });
    expect(readBoardView()).toEqual({ mode: "3d", tilt: "flat" });
    expect(readBoardView()).toBe(readBoardView());
  });

  it("does not touch the duel preferences key", () => {
    window.localStorage.setItem("yugidraft.duelPreferences.v1", "keep");
    writeBoardView({ mode: "3d", tilt: "tilt" });
    expect(window.localStorage.getItem("yugidraft.duelPreferences.v1")).toBe("keep");
  });

  it("lets the override win for the mode without saving it", () => {
    window.localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify({ v: 1, mode: "classic", tilt: "flat" }));
    const { result } = renderHook(() => useBoardView("3d"));
    expect(result.current).toMatchObject({ mode: "3d", tilt: "flat" });
    expect(JSON.parse(window.localStorage.getItem(BOARD_VIEW_KEY)!).mode).toBe("classic");
    const classic = renderHook(() => useBoardView("classic"));
    writeBoardView({ mode: "3d", tilt: "flat" });
    expect(classic.result.current.mode).toBe("classic");
  });

  it("updates through the setters and notifies in this tab", () => {
    const { result } = renderHook(() => useBoardView());
    expect(result.current.mode).toBe("classic");
    act(() => result.current.setMode("3d"));
    expect(result.current.mode).toBe("3d");
    act(() => result.current.setTilt("flat"));
    expect(result.current).toMatchObject({ mode: "3d", tilt: "flat" });
    expect(readBoardView()).toEqual({ mode: "3d", tilt: "flat" });
  });

  it("notifies on the storage event of another tab", () => {
    const { result } = renderHook(() => useBoardView());
    act(() => {
      window.localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify({ v: 1, mode: "3d", tilt: "tilt" }));
      window.dispatchEvent(new StorageEvent("storage", { key: BOARD_VIEW_KEY }));
    });
    expect(result.current.mode).toBe("3d");
  });

  it("ignores the storage event of other keys", () => {
    const { result } = renderHook(() => useBoardView());
    const before = result.current;
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "other" })); });
    expect(result.current).toBe(before);
  });
});
