// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeDuelWindow, closePendingDuelWindow, duelSlugFromHref, duelWindowName, duelWindowPath, exitDuelWindow, focusDuelWindowOnClick,
  focusOpenDuelWindow, isDuelWindow, liveDuelWindow, navigateDuelWindow, openDuelWindow, openPendingDuelWindow, renameDuelWindow,
} from "@/components/duel/duel-window";

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

describe("starting a duel from a click", () => {
  const fakeWindow = () => ({ closed: false, name: "", location: { href: "about:blank" }, focus: vi.fn(), close: vi.fn(),
    document: { title: "", body: { style: { cssText: "" }, textContent: "" } } });

  it("opens a pending window inside the click and sends it to the duel once the slug is known", () => {
    const pending = fakeWindow();
    const open = vi.spyOn(window, "open").mockReturnValue(pending as unknown as Window);
    expect(openPendingDuelWindow()).toBe(pending);
    expect(open).toHaveBeenCalledWith("", expect.stringMatching(/^yugidraft-duel-pending-/));
    expect(pending.location.href).toBe("about:blank");
    expect(navigateDuelWindow(pending as unknown as Window, "new-duel")).toBe(true);
    expect(pending.name).toBe("yugidraft-duel-new-duel");
    expect(pending.location.href).toBe("/duels/new-duel?window=1");
    expect(pending.focus).toHaveBeenCalled();
  });

  it("gives each click its own pending window name", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(fakeWindow() as unknown as Window);
    openPendingDuelWindow();
    openPendingDuelWindow();
    expect(open.mock.calls[0][1]).not.toBe(open.mock.calls[1][1]);
  });

  it("finds the window of a later game by its current name, not the slug it was opened with", () => {
    const pending = fakeWindow();
    navigateDuelWindow(pending as unknown as Window, "series-game-1");
    expect(liveDuelWindow("series-game-2")).toBeNull();
    // The window follows the series and names itself for game 2.
    pending.name = "yugidraft-duel-series-game-2";
    expect(liveDuelWindow("series-game-2")).toBe(pending);
    expect(liveDuelWindow("series-game-1")).toBeNull();
    pending.focus.mockClear();
    expect(focusOpenDuelWindow("series-game-2")).toBe(true);
    expect(pending.focus).toHaveBeenCalled();
    pending.closed = true;
    expect(liveDuelWindow("series-game-2")).toBeNull();
  });

  it("names a window for the next game ahead of its own move", () => {
    const pending = fakeWindow();
    navigateDuelWindow(pending as unknown as Window, "bo3-1");
    renameDuelWindow(pending as unknown as Window, "bo3-2");
    expect(liveDuelWindow("bo3-2")).toBe(pending);
  });

  it("forgets a window it closed", () => {
    const pending = fakeWindow();
    navigateDuelWindow(pending as unknown as Window, "gone-2");
    closeDuelWindow(pending as unknown as Window);
    expect(pending.close).toHaveBeenCalled();
    expect(liveDuelWindow("gone-2")).toBeNull();
    expect(() => closeDuelWindow(null)).not.toThrow();
  });

  it("returns null for a blocked pending window", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openPendingDuelWindow()).toBeNull();
  });

  it("does not navigate a window the player closed meanwhile", () => {
    const pending = { ...fakeWindow(), closed: true };
    expect(navigateDuelWindow(pending as unknown as Window, "gone")).toBe(false);
    expect(pending.location.href).toBe("about:blank");
    expect(focusOpenDuelWindow("gone")).toBe(false);
  });

  it("closes a pending window after a failed start", () => {
    const pending = fakeWindow();
    closePendingDuelWindow(pending as unknown as Window);
    expect(pending.close).toHaveBeenCalled();
    expect(() => closePendingDuelWindow(null)).not.toThrow();
  });

  it("reuses a window this page opened: an Open duel click focuses it instead of navigating", () => {
    const pending = fakeWindow();
    navigateDuelWindow(pending as unknown as Window, "live-1");
    pending.focus.mockClear();
    const event = { preventDefault: vi.fn(), button: 0 };
    focusDuelWindowOnClick("/duels/live-1", event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(pending.focus).toHaveBeenCalled();

    const other = { preventDefault: vi.fn(), button: 0 };
    focusDuelWindowOnClick("/duels/other", other);
    expect(other.preventDefault).not.toHaveBeenCalled();

    pending.closed = true;
    const afterClose = { preventDefault: vi.fn(), button: 0 };
    focusDuelWindowOnClick("/duels/live-1", afterClose);
    expect(afterClose.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves modified clicks to the browser", () => {
    const pending = fakeWindow();
    navigateDuelWindow(pending as unknown as Window, "live-2");
    const event = { preventDefault: vi.fn(), button: 0, ctrlKey: true };
    focusDuelWindowOnClick("/duels/live-2", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("reads the slug of a duel link", () => {
    expect(duelSlugFromHref("/duels/abc")).toBe("abc");
    expect(duelSlugFromHref("/duels/abc?invite=x")).toBe("abc");
    expect(duelSlugFromHref("/tournaments/abc")).toBeNull();
  });
});
