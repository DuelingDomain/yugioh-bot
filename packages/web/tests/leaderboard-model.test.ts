import { describe, expect, it } from "vitest";
import { getPlayerPosition, getTierProgress, getTierCounts, getWinningsGuide } from "@/components/leaderboard/leaderboard-model";
import { referenceRows } from "./fixtures/leaderboard";

describe("leaderboard numbers", () => {
  it("uses ledger order for place and the winnings gap to the player above", () => {
    expect(getPlayerPosition(referenceRows, 5)).toMatchObject({
      place: 5, gap: 22, gapLabel: "22 behind Toon Tina", above: { displayName: "Toon Tina" },
    });
  });

  it("has no gap at first place and no position for a missing player", () => {
    expect(getPlayerPosition(referenceRows, 1)).toMatchObject({ place: 1, above: null, gapLabel: null });
    expect(getPlayerPosition(referenceRows, 99)).toBeNull();
    expect(getPlayerPosition(referenceRows, null)).toBeNull();
    expect(getPlayerPosition([], 5)).toBeNull();
  });

  it("keeps a zero winnings gap for a tie without claiming it would pass", () => {
    const rows = referenceRows.map((row) => row.playerId === 5 ? { ...row, winnings: 198 } : row);
    expect(getPlayerPosition(rows, 5)?.gapLabel).toBe("0 behind Toon Tina");
  });

  it("derives Gold progress and the next tier from scoring thresholds", () => {
    expect(getTierProgress(1184)).toMatchObject({
      tier: "Gold", nextTier: "Platinum", remaining: 166, percent: 34,
      label: "166 Elo to Platinum", points: 84, span: 250,
    });
  });

  it("fills Diamond and calls it the top tier", () => {
    expect(getTierProgress(1612)).toMatchObject({ tier: "Diamond", nextTier: null, percent: 100, label: "Top tier" });
  });

  it.each([[900, "Silver"], [1100, "Gold"], [1350, "Platinum"]])("starts %i at the bottom of %s", (rating, tier) => {
    expect(getTierProgress(Number(rating))).toMatchObject({ tier, percent: 0 });
  });

  it("counts current Elo tiers across the eleven players", () => {
    expect(getTierCounts(referenceRows).map(({ name, count }) => [name, count])).toEqual([
      ["Diamond", 1], ["Platinum", 1], ["Gold", 4], ["Silver", 3], ["Bronze", 2],
    ]);
    expect(getTierCounts([]).every(({ count }) => count === 0)).toBe(true);
  });

  it("computes the match range and all tournament award brackets", () => {
    const guide = getWinningsGuide();
    expect(guide).toMatchObject({ min: 3, max: 10, equal: 5 });
    expect(guide.brackets.map(({ label, awards }) => [label, ...awards])).toEqual([
      ["Under 8", 50, 30, 15], ["8 to 15", 75, 45, 23],
      ["16 to 31", 100, 60, 30], ["32 and up", 150, 90, 45],
    ]);
  });
});
