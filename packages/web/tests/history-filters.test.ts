import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY_FILTERS, hasHistoryFilters, historyQuery, lobbySearch, parseHistoryParams, presetRange, toLocalInput,
} from "../src/components/duel/history-filters";

describe("history filters", () => {
  it("builds a stable query and leaves empty filters out", () => {
    expect(historyQuery("mine")).toBe("archived=1&scope=mine");
    expect(historyQuery("all", { ...EMPTY_HISTORY_FILTERS, format: "tag", status: "cancelled", q: " Bo ", card: "Dark Magician" }, "c1"))
      .toBe("archived=1&scope=all&format=tag&status=cancelled&q=Bo&card=Dark+Magician&cursor=c1");
  });

  it("ignores a bad date and reads good values from page params", () => {
    const parsed = parseHistoryParams({ scope: "all", from: "nope", to: "2026-10-10T20:00", format: "ffa9", status: "interrupted", q: [" A ", "B"] });
    expect(parsed).toEqual({
      scope: "all",
      filters: { from: "", to: "2026-10-10T20:00", format: "", status: "interrupted", q: "A", card: "" },
    });
    expect(hasHistoryFilters(parsed.filters)).toBe(true);
    expect(hasHistoryFilters(EMPTY_HISTORY_FILTERS)).toBe(false);
  });

  it("round-trips through the page URL", () => {
    const filters = { from: "2026-10-10T00:00", to: "", format: "ffa4" as const, status: "" as const, q: "Imran", card: "" };
    const search = lobbySearch(true, "all", filters);
    expect(parseHistoryParams(new URLSearchParams(search))).toEqual({ scope: "all", filters });
    expect(lobbySearch(false, "all", filters)).toBe("");
  });

  it("computes the quick ranges in local time", () => {
    const now = new Date(2026, 9, 11, 15, 30);
    expect(presetRange("today", now)).toEqual({ from: "2026-10-11T00:00", to: "" });
    expect(presetRange("yesterday", now)).toEqual({ from: "2026-10-10T00:00", to: "2026-10-10T23:59" });
    expect(presetRange("week", now)).toEqual({ from: "2026-10-04T15:30", to: "" });
    expect(toLocalInput(new Date(2026, 0, 2, 3, 4))).toBe("2026-01-02T03:04");
  });
});
