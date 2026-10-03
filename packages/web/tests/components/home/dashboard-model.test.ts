import { describe, expect, it } from "vitest";
import { tierProgress, tournamentFormatLabel, winRatePercent, draftStatus } from "@/components/dashboard/dashboard-model";

describe("dashboard model", () => {
  it("measures progress through a tier", () => {
    const p = tierProgress(1184, { name: "Gold", min: 1100, nextAt: 1350 });
    expect(p).toMatchObject({ nextTier: "Platinum", toNext: 166, into: 84, span: 250 });
    expect(p.fraction).toBeCloseTo(0.336);
  });

  it("has no next tier at the top", () => {
    expect(tierProgress(1700, { name: "Diamond", min: 1600, nextAt: null })).toMatchObject({ nextTier: null, toNext: null, fraction: 1 });
  });

  it("computes win rate and labels", () => {
    expect(winRatePercent(15, 9)).toBe(63);
    expect(winRatePercent(0, 0)).toBe(0);
    expect(tournamentFormatLabel("single_elim")).toBe("Single elimination");
    expect(tournamentFormatLabel("round_robin")).toBe("Round robin");
    expect(draftStatus("active").live).toBe(true);
    expect(draftStatus("pending").live).toBe(false);
  });
});
