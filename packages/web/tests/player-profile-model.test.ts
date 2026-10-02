import { describe, expect, it } from "vitest";
import {
  buildAchievements, formatDay, freshUnlocks, getEloGuide, groupAwards, winningsThisWeek, type AwardEntry,
} from "@/components/player/profile-model";

const award = (over: Partial<AwardEntry>): AwardEntry => ({
  kind: "match", points: 5, created_at: "2026-09-26 20:00:00", tournament_id: null, tournament_name: null, ...over,
});

describe("profile model", () => {
  it("groups consecutive awards by event, and untied ones as ranked matches", () => {
    const groups = groupAwards([
      award({ tournament_id: 12, tournament_name: "FND #12" }),
      award({ tournament_id: 12, tournament_name: "FND #12" }),
      award({}),
      award({ tournament_id: 11, tournament_name: "FND #11", kind: "placement" }),
    ]);
    expect(groups.map((g) => [g.title, g.entries.length])).toEqual([["FND #12", 2], ["Ranked matches", 1], ["FND #11", 1]]);
  });

  it("sums the week only when the payload can show all of it", () => {
    const now = Date.parse("2026-09-27T00:00:00Z");
    expect(winningsThisWeek([award({ points: 8 }), award({ points: 5, created_at: "2026-09-01 10:00:00" })], now)).toBe(8);
    expect(winningsThisWeek([award({ created_at: "2026-09-01 10:00:00" })], now)).toBeNull();
    expect(winningsThisWeek(Array.from({ length: 10 }, () => award({})), now)).toBeNull();
  });

  it("formats unlock days in UTC", () => {
    expect(formatDay("2026-08-21 23:30:00")).toBe("Fri, Aug 21");
  });

  it("computes the Elo guide from the scoring maths", () => {
    expect(getEloGuide().map((r) => [r.win, r.loss])).toEqual([[8, -24], [16, -16], [24, -8], [29, -3]]);
  });

  it("orders achievements: new, earned newest first, locked in a fixed order", () => {
    const views = buildAchievements({
      unlocked: [
        { achievement_key: "first_tournament_win", unlocked_at: "2026-06-12 10:00:00" },
        { achievement_key: "giant_slayer", unlocked_at: "2026-08-21 10:00:00" },
        { achievement_key: "champion_x3", unlocked_at: "2026-09-24 10:00:00" },
      ],
      careerWinnings: 986, fresh: ["champion_x3"], isOwner: true,
    });
    expect(views.map((v) => [v.key, v.state])).toEqual([
      ["champion_x3", "new"], ["giant_slayer", "on"], ["first_tournament_win", "on"],
      ["streak_10", "off"], ["winnings_1000", "off"], ["winnings_5000", "off"],
    ]);
    expect(views[4].progress).toMatchObject({ toGo: 14, close: true });
    expect(views[5].progress).toMatchObject({ value: 986, goal: 5000, close: false });
    expect(views[3].progress).toBeNull();
  });

  it("hides progress and New on someone else's profile", () => {
    const views = buildAchievements({
      unlocked: [{ achievement_key: "champion_x3", unlocked_at: "2026-09-24 10:00:00" }],
      careerWinnings: 986, fresh: ["champion_x3"], isOwner: false,
    });
    expect(views.find((v) => v.key === "champion_x3")!.state).toBe("on");
    expect(views.every((v) => v.progress === null)).toBe(true);
  });

  it("lights nothing on a device's first visit", () => {
    expect(freshUnlocks(null, ["a", "b"])).toEqual([]);
    expect(freshUnlocks('["a"]', ["a", "b"])).toEqual(["b"]);
    expect(freshUnlocks("garbage", ["a"])).toEqual([]);
  });
});
