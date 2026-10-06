import { describe, expect, it } from "vitest";
import {
  commitUrl, dataAsOf, filterGap, newUpstreamCdbFiles, recentIdMismatch, relativeTime, setGapState, shortSha, sortGap, sortSets, summarize,
} from "../src/lib/card-data-status-model";
import { behindStatus, coldStatus, completeSet, freshStatus, gapCards, missingSet, unknownSet, unknownSource } from "./fixtures/card-data-status";

describe("summarize", () => {
  it("is up to date when every source matches and there is no gap", () => {
    expect(summarize(freshStatus())).toMatchObject({ state: "up-to-date", reasons: [] });
  });

  it("names days behind Project Ignis first", () => {
    const status = behindStatus();
    status.gap.recentSets = [missingSet("Rage", "RA05", "2026-09-26", 60, 42)];
    status.gap.recentSetsMissingFromEngineCount = 42;
    const summary = summarize(status);
    expect(summary.state).toBe("behind");
    expect(summary.headline).toBe("Engine data 3 days behind Project Ignis");
    expect(summary.reasons).toContain("42 new TCG cards not in the engine yet in 1 recent set");
  });

  it("falls back to commits when the day count is zero", () => {
    const status = behindStatus();
    status.upstream.sources.database.behindDays = 0;
    expect(summarize(status).headline).toBe("Engine data 12 commits behind Project Ignis");
  });

  it("reports a missing card in a recent set alone as behind", () => {
    const status = freshStatus();
    status.gap.recentSets = [missingSet("Rage", "RA05", "2026-09-26", 60, 1)];
    status.gap.recentSetsMissingFromEngineCount = 1;
    expect(summarize(status)).toMatchObject({ state: "behind", headline: "1 new TCG card not in the engine yet in 1 recent set" });
  });

  it("does not count cached catalog cards as behind", () => {
    const status = freshStatus();
    status.gap.cachedCatalogMissingCount = 500;
    status.gap.cachedCatalogMissing = gapCards(5);
    status.gap.cachedCatalogIdMismatch = gapCards(2);
    expect(summarize(status).state).toBe("up-to-date");
  });

  it("is unknown, never up to date, when a recent set was never checked", () => {
    const status = freshStatus();
    status.gap.recentSets = [completeSet("Old", "OL01", "2026-01-01", 50), unknownSet("Rage", "RA05", "2026-09-26")];
    status.gap.recentSetsMissingFromEngineCount = 0;
    status.gap.recentSetsUnknownCount = 1;
    expect(summarize(status)).toMatchObject({ state: "unknown", headline: "1 set not checked yet" });
  });

  it("is unknown when the recent set list is empty and not synced", () => {
    const status = freshStatus();
    status.gap.recentSets = [];
    status.gap.recentSetsMissingFromEngineCount = null;
    expect(summarize(status)).toMatchObject({ state: "unknown", headline: "Recent TCG sets are not synced yet, so new cards cannot be compared" });
  });

  it("says at least when a known gap sits beside an unknown set", () => {
    const status = freshStatus();
    status.gap.recentSets = [missingSet("A", "A1", "2026-09-26", 60, 4), unknownSet("B", "B1", "2026-08-01")];
    status.gap.recentSetsMissingFromEngineCount = 4;
    status.gap.recentSetsUnknownCount = 1;
    const summary = summarize(status);
    expect(summary.state).toBe("behind");
    expect(summary.headline).toBe("At least 4 new TCG cards not in the engine yet in 1 recent set");
  });

  it("reports unloaded upstream release files as behind", () => {
    const status = freshStatus();
    status.upstream.babelCdbFiles.files.push("release-new.cdb");
    expect(summarize(status).headline).toBe("1 new release file upstream not loaded");
  });

  it("is unknown, not up to date, when HEAD is known but the compare failed", () => {
    const status = freshStatus();
    status.upstream.sources.database = { ...status.upstream.sources.database, comparison: "unknown", behindCommits: null, behindDays: null };
    expect(summarize(status)).toMatchObject({ state: "unknown", headline: "1 engine source could not be checked against GitHub" });
  });

  it("does not call a pin that is newer than upstream HEAD behind", () => {
    const status = freshStatus();
    status.upstream.sources.database = { ...status.upstream.sources.database, comparison: "behind", behindCommits: 0, behindDays: 0 };
    expect(summarize(status).state).toBe("up-to-date");
  });

  it("treats a diverged pin as behind", () => {
    const status = freshStatus();
    status.upstream.sources.scripts = { ...status.upstream.sources.scripts, comparison: "diverged", behindCommits: 0, behindDays: 0 };
    expect(summarize(status)).toMatchObject({ state: "behind", headline: "Engine data is behind Project Ignis" });
  });

  it("is unknown when GitHub failed for every source", () => {
    const status = freshStatus();
    status.upstream.sources = { database: unknownSource("database"), scripts: unknownSource("scripts"), strings: unknownSource("strings") };
    status.upstream.babelCdbFiles = { status: "unknown", files: [] };
    expect(summarize(status)).toMatchObject({ state: "unknown", headline: "Cannot reach GitHub, so engine data age is unknown" });
  });

  it("keeps a known problem ahead of an unknown source", () => {
    const status = behindStatus();
    status.upstream.sources.strings = unknownSource("strings");
    const summary = summarize(status);
    expect(summary.state).toBe("behind");
    expect(summary.reasons).toContain("1 engine source could not be checked against GitHub");
  });
});

describe("cold GitHub read", () => {
  it("is unknown, not up to date, when GitHub has not been checked yet", () => {
    const status = freshStatus();
    status.upstream.checkedAt = null;
    expect(summarize(status)).toMatchObject({ state: "unknown", headline: "GitHub check is running. Refresh in a moment." });
  });

  it("puts the cold read ahead of the other unknown reasons", () => {
    expect(summarize(coldStatus())).toEqual({
      state: "unknown",
      headline: "GitHub check is running. Refresh in a moment.",
      reasons: ["GitHub check is running. Refresh in a moment."],
    });
  });

  it("never shows less than the recent sets add up to", () => {
    const status = freshStatus();
    status.gap.recentSets = [missingSet("A", "A1", "2026-09-26", 60, 4), missingSet("B", "B1", "2026-08-01", 60, 3)];
    status.gap.recentSetsMissingFromEngineCount = 5;
    expect(summarize(status).headline).toBe("7 new TCG cards not in the engine yet in 2 recent sets");
  });
});

describe("recent sets", () => {
  it("reads null counts and unknown status as unknown, not complete", () => {
    expect(setGapState(completeSet("A", "A1", "2026-01-01", 10))).toBe("complete");
    expect(setGapState(missingSet("A", "A1", "2026-01-01", 10, 2))).toBe("missing");
    expect(setGapState(unknownSet("A", "A1", "2026-01-01"))).toBe("unknown");
    expect(setGapState({ ...completeSet("A", "A1", "2026-01-01", 10), status: "unknown" })).toBe("unknown");
  });

  it("sorts sets newest first and keeps undated sets last", () => {
    const sets = [
      completeSet("Old", "O", "2026-01-01", 1),
      { ...completeSet("Nodate", "N", "2026-01-01", 1), releaseDate: null },
      completeSet("New", "W", "2026-09-26", 1),
    ];
    expect(sortSets(sets).map((set) => set.name)).toEqual(["New", "Old", "Nodate"]);
  });

  it("lists same-card-different-ID cards once", () => {
    const status = freshStatus();
    const a = { ...completeSet("A", "A1", "2026-09-01", 5), idMismatch: gapCards(2) };
    const b = { ...completeSet("B", "B1", "2026-08-01", 5), idMismatch: gapCards(3) };
    status.gap.recentSets = [a, b];
    expect(recentIdMismatch(status).map((card) => card.id)).toEqual([10000, 10001, 10002]);
  });

  it("uses the newest pinned commit date as data as of", () => {
    const status = freshStatus();
    status.engine.sources.scripts.pinnedCommitDate = "2026-09-30T10:00:00Z";
    status.engine.sources.strings.pinnedCommitDate = null;
    expect(dataAsOf(status)).toBe("2026-09-30T10:00:00Z");
    for (const key of ["database", "scripts", "strings"] as const) status.engine.sources[key].pinnedCommitDate = null;
    expect(dataAsOf(status)).toBeNull();
  });
});

describe("helpers", () => {
  it("shortens SHAs and builds commit links", () => {
    expect(shortSha("abcdef1234567")).toBe("abcdef1");
    expect(shortSha(null)).toBe("unknown");
    expect(commitUrl("ProjectIgnis/BabelCDB", "abc")).toBe("https://github.com/ProjectIgnis/BabelCDB/commit/abc");
    expect(commitUrl("https://github.com/ProjectIgnis/BabelCDB.git", "abc")).toBe("https://github.com/ProjectIgnis/BabelCDB/commit/abc");
    expect(commitUrl("not a repo", "abc")).toBeNull();
    expect(commitUrl("ProjectIgnis/BabelCDB", null)).toBeNull();
  });

  it("formats relative time", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(relativeTime("2026-10-06T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-10-06T11:15:00Z", now)).toBe("45 minutes ago");
    expect(relativeTime("2026-10-06T07:00:00Z", now)).toBe("5 hours ago");
    expect(relativeTime("2026-10-01T12:00:00Z", now)).toBe("5 days ago");
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime("nope", now)).toBeNull();
  });

  it("finds only unloaded release files", () => {
    const status = freshStatus();
    status.upstream.babelCdbFiles.files = ["cards.cdb", "release-rota.cdb", "Release-New.cdb", "prerelease-x.cdb"];
    expect(newUpstreamCdbFiles(status)).toEqual(["Release-New.cdb"]);
    status.upstream.babelCdbFiles.status = "unknown";
    expect(newUpstreamCdbFiles(status)).toEqual([]);
  });

  it("sorts the gap newest first and filters by name, passcode and set code", () => {
    const cards = [
      { id: 1, name: "Old", setCode: "AA-1", setReleaseDate: "2020-01-01" },
      { id: 2, name: "None", setCode: null, setReleaseDate: null },
      { id: 3, name: "Blue-Eyes", setCode: "RA05-EN001", setReleaseDate: "2026-09-26" },
    ];
    expect(sortGap(cards).map((c) => c.id)).toEqual([3, 1, 2]);
    expect(filterGap(cards, "blue").map((c) => c.id)).toEqual([3]);
    expect(filterGap(cards, "ra05").map((c) => c.id)).toEqual([3]);
    expect(filterGap(cards, "2").map((c) => c.id)).toEqual([2]);
    expect(filterGap(cards, "  ")).toHaveLength(3);
    expect(sortGap(gapCards(4))[0].setReleaseDate).toBe("2026-09-26");
  });
});
