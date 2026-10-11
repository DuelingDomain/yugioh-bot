// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberHistorySearch, savedHistoryHref } from "../../src/components/duel/history-filters";
import { useMatchHistoryHref } from "../../src/components/duel/history-link";

function Probe({ viewerId = 7 }: { viewerId?: number }) {
  return <a href={useMatchHistoryHref(viewerId)}>Match history</a>;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Match history link of the replay page", () => {
  it("goes to the plain history when nothing is saved", () => {
    render(<Probe />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/duels?view=history");
  });

  it("goes back with the filters the user last used", async () => {
    rememberHistorySearch("?view=history&scope=all&format=tag&q=Imran", 7);
    render(<Probe />);
    await waitFor(() => expect(screen.getByRole("link")).toHaveAttribute("href", "/duels?view=history&scope=all&format=tag&q=Imran"));
  });

  it("drops bad saved values", async () => {
    rememberHistorySearch("?view=history&from=nope&format=ffa9&evil=1&q=Ok", 7);
    render(<Probe />);
    await waitFor(() => expect(screen.getByRole("link")).toHaveAttribute("href", "/duels?view=history&q=Ok"));
  });

  it("ignores a search that another user saved in the same tab", async () => {
    rememberHistorySearch("?view=history&q=Secret", 7);
    render(<Probe viewerId={8} />);
    await Promise.resolve();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/duels?view=history");
    expect(savedHistoryHref(8)).toBe("/duels?view=history");
    expect(savedHistoryHref(7)).toBe("/duels?view=history&q=Secret");
  });

  it("ignores text that is not a saved search", () => {
    for (const bad of ["?view=history&q=Old", "null", "42", "{\"search\":5,\"viewer\":\"7\"}", "{oops"]) {
      window.sessionStorage.setItem("duels.history-search", bad);
      expect(savedHistoryHref(7)).toBe("/duels?view=history");
    }
  });

  it("works when the storage throws", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => rememberHistorySearch("?view=history&q=A", 7)).not.toThrow();
    expect(setItem).toHaveBeenCalled();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(savedHistoryHref(7)).toBe("/duels?view=history");
  });

  it("works when the storage object itself throws", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => rememberHistorySearch("?view=history&q=A", 7)).not.toThrow();
    expect(savedHistoryHref(7)).toBe("/duels?view=history");
  });
});
