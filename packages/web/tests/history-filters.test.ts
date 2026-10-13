import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY_FILTERS, hasHistoryFilters, historyQuery, lobbySearch, mergeLobbySearch, parseHistoryParams, presetRange, toLocalInput,
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

  it("sends and writes the status only for an admin on All", () => {
    const filters = { ...EMPTY_HISTORY_FILTERS, status: "cancelled" as const };
    expect(historyQuery("mine", filters)).toBe("archived=1&scope=mine");
    expect(historyQuery("all", filters)).toBe("archived=1&scope=all&status=cancelled");
    expect(lobbySearch(true, "mine", filters)).toBe("?view=history");
    expect(lobbySearch(true, "all", filters)).toBe("?view=history&scope=all&status=cancelled");
  });

  it("accepts only datetime-local text for from and to", () => {
    const read = (from: string) => parseHistoryParams({ from }).filters.from;
    expect(read("2026-10-10T20:00")).toBe("2026-10-10T20:00");
    expect(read("2026-10-10T20:00:30")).toBe("2026-10-10T20:00:30");
    expect(read("2026-10-10")).toBe("");
    expect(read("Oct 10 2026")).toBe("");
    expect(read("2026-13-45T20:00")).toBe("");
    expect(read("2026-10-10T20:00Z")).toBe("");
  });

  it("keeps other page params and removes only the lobby params", () => {
    const filters = { ...EMPTY_HISTORY_FILTERS, q: "Imran" };
    expect(mergeLobbySearch("?invite=abc", false, "mine", filters)).toBe("?invite=abc");
    expect(mergeLobbySearch("?view=history&q=Imran&invite=abc", false, "mine", filters)).toBe("?invite=abc");
    expect(mergeLobbySearch("?view=history&q=Imran", false, "mine", filters)).toBe("");
    expect(mergeLobbySearch("?invite=abc", true, "mine", filters)).toBe("?view=history&q=Imran&invite=abc");
    expect(mergeLobbySearch("", true, "all", EMPTY_HISTORY_FILTERS)).toBe("?view=history&scope=all");
  });
});

describe("history filters across daylight saving time", () => {
  const original = process.env.TZ;
  afterAll(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; });

  describe("America/New_York", () => {
    beforeAll(() => { process.env.TZ = "America/New_York"; });

    it("keeps yesterday as a whole local day on the spring-forward day", () => {
      const now = new Date(2026, 2, 9, 12, 0); // Monday after the 8 March change
      expect(presetRange("yesterday", now)).toEqual({ from: "2026-03-08T00:00", to: "2026-03-08T23:59" });
      const query = new URLSearchParams(historyQuery("mine", { ...EMPTY_HISTORY_FILTERS, ...presetRange("yesterday", now) }));
      // 23 hours long: 05:00Z to 03:59:59.999Z the next day.
      expect(query.get("from")).toBe("2026-03-08T05:00:00.000Z");
      expect(query.get("to")).toBe("2026-03-09T03:59:59.999Z");
    });

    it("keeps yesterday as a whole local day on the fall-back day", () => {
      const now = new Date(2026, 10, 2, 12, 0);
      expect(presetRange("yesterday", now)).toEqual({ from: "2026-11-01T00:00", to: "2026-11-01T23:59" });
      const query = new URLSearchParams(historyQuery("mine", { ...EMPTY_HISTORY_FILTERS, ...presetRange("yesterday", now) }));
      // 25 hours long: 04:00Z to 04:59:59.999Z the next day.
      expect(query.get("from")).toBe("2026-11-01T04:00:00.000Z");
      expect(query.get("to")).toBe("2026-11-02T04:59:59.999Z");
    });
  });

  describe("America/Santiago", () => {
    beforeAll(() => { process.env.TZ = "America/Santiago"; });

    it("starts yesterday at its own midnight, or at the first real hour when that day has none", () => {
      // 6 September 2026: the clocks jump from 00:00 to 01:00, so local midnight does not exist on that day.
      // Today is the gap day: yesterday must still start at its own midnight (not at 01:00).
      expect(presetRange("yesterday", new Date(2026, 8, 6, 12, 0)).from).toBe("2026-09-05T00:00");
      // Yesterday is the gap day: it starts at its first real hour.
      expect(presetRange("yesterday", new Date(2026, 8, 7, 12, 0)).from).toBe("2026-09-06T01:00");
    });
  });
});
