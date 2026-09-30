// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { duelWindowName, duelWindowPath, exitDuelWindow, isDuelWindow, openDuelWindow } from "@/components/duel/duel-window";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.name = "";
});

describe("duel window helpers", () => {
  it("names and addresses one window per duel", () => {
    expect(duelWindowName("abc")).toBe("yugidraft-duel-abc");
    expect(duelWindowPath("abc")).toBe("/duels/abc?window=1");
  });

  it("detects the duel window by name", () => {
    expect(isDuelWindow("abc")).toBe(false);
    window.name = "yugidraft-duel-abc";
    expect(isDuelWindow("abc")).toBe(true);
    expect(isDuelWindow("other")).toBe(false);
  });

  it("navigates a fresh blank window to the duel and focuses an existing one", () => {
    const fresh = { location: { href: "about:blank" }, focus: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(fresh as unknown as Window);
    expect(openDuelWindow("abc")).toBe(fresh);
    expect(open).toHaveBeenCalledWith("", "yugidraft-duel-abc");
    expect(fresh.location.href).toBe("/duels/abc?window=1");

    const existing = { location: { href: "http://localhost/duels/abc?window=1" }, focus: vi.fn() };
    open.mockReturnValue(existing as unknown as Window);
    openDuelWindow("abc");
    expect(existing.focus).toHaveBeenCalled();
    expect(existing.location.href).toBe("http://localhost/duels/abc?window=1");
  });

  it("returns null when the pop-up is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openDuelWindow("abc")).toBeNull();
  });

  it("closes the window and sends the opener to the tables list", () => {
    const opener = { closed: false, location: { pathname: "/duels/abc", assign: vi.fn() } };
    Object.defineProperty(window, "opener", { value: opener, configurable: true });
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    exitDuelWindow("abc", vi.fn());
    expect(opener.location.assign).toHaveBeenCalledWith("/duels");
    expect(close).toHaveBeenCalled();
    Object.defineProperty(window, "opener", { value: null, configurable: true });
  });

  it("falls back to navigation when the window cannot close", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "close").mockImplementation(() => undefined);
    const fallback = vi.fn();
    exitDuelWindow("abc", fallback);
    vi.advanceTimersByTime(200);
    expect(fallback).toHaveBeenCalled();
  });
});
