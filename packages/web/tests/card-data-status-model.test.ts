import { describe, expect, it } from "vitest";
import {
  commitUrl, filterGap, newUpstreamCdbFiles, relativeTime, shortSha, sortGap, summarize,
} from "../src/lib/card-data-status-model";
import { behindStatus, freshStatus, gapCards, unknownSource } from "./fixtures/card-data-status";

describe("summarize", () => {
  it("is up to date when every source matches and there is no gap", () => {
    expect(summarize(freshStatus())).toMatchObject({ state: "up-to-date", reasons: [] });
  });

  it("names days behind Project Ignis first", () => {
    const status = behindStatus();
    status.gap.catalogMissingFromEngineCount = 42;
    const summary = summarize(status);
    expect(summary.state).toBe("behind");
    expect(summary.headline).toBe("Engine data 3 days behind Project Ignis");
    expect(summary.reasons).toContain("42 TCG cards not in the duel engine");
  });

  it("falls back to commits when the day count is zero", () => {
    const status = behindStatus();
    status.upstream.sources.database.behindDays = 0;
    expect(summarize(status).headline).toBe("Engine data 12 commits behind Project Ignis");
  });

  it("reports a gap alone as behind", () => {
    const status = freshStatus();
    status.gap.catalogMissingFromEngineCount = 1;
    expect(summarize(status)).toMatchObject({ state: "behind", headline: "1 TCG card not in the duel engine" });
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
