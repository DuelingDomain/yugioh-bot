import { describe, expect, it } from "vitest";
import {
  buildAchievements, formatDay, freshUnlocks, getEloGuide, groupAwards, orderAchievements, winningsThisWeek,
  type AchievementView, type AwardEntry,
} from "@/components/player/profile-model";

const award = (over: Partial<AwardEntry>): AwardEntry => ({
  kind: "match", points: 5, created_at: "2026-09-26 20:00:00", tournament_id: null, tournament_name: null, ...over,
});

const achievement = (over: Partial<AchievementView>): AchievementView => ({
  key: "untracked", name: "Achievement", icon: "medal", criteria: "Win a match.",
  state: "off", unlockedAt: null, progress: null, isOwnerLocked: true, ...over,
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

  it("orders new achievements first, then earned newest first, then locked ones closest to their goal", () => {
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
      ["winnings_1000", "off"], ["winnings_5000", "off"], ["streak_10", "off"],
    ]);
    expect(views[3].progress).toMatchObject({ toGo: 14, close: true });
    expect(views[4].progress).toMatchObject({ value: 986, goal: 5000, close: false });
    expect(views[5].progress).toBeNull();
  });

  it("sorts new achievements first, and locked ones by progress ratio rather than value, without mutating the list", () => {
    const views = [
      achievement({ key: "untracked" }),
      achievement({ key: "fresh", state: "new", unlockedAt: "2026-09-24T12:00:00+02:00" }),
      achievement({ key: "large", progress: { value: 4000, goal: 5000, toGo: 1000, close: false } }),
      achievement({ key: "newest", state: "on", unlockedAt: "2026-09-24 11:00:00" }),
      achievement({ key: "close", progress: { value: 900, goal: 1000, toGo: 100, close: true } }),
      achievement({ key: "zero", progress: { value: 0, goal: 1000, toGo: 1000, close: false } }),
    ];
    expect(orderAchievements(views).map((view) => view.key)).toEqual([
      "fresh", "newest", "close", "large", "zero", "untracked",
    ]);
    expect(views.map((view) => view.key)).toEqual([
      "untracked", "fresh", "large", "newest", "close", "zero",
    ]);
  });

  it("puts older new achievements before newer earned ones, with each group newest first", () => {
    const views = [
      achievement({ key: "earned-older", state: "on", unlockedAt: "2026-09-26 10:00:00" }),
      achievement({ key: "new-older", state: "new", unlockedAt: "2026-09-23 10:00:00" }),
      achievement({ key: "earned-newer", state: "on", unlockedAt: "2026-09-27 10:00:00" }),
      achievement({ key: "new-newer", state: "new", unlockedAt: "2026-09-24 10:00:00" }),
    ];
    expect(orderAchievements(views).map((view) => view.key)).toEqual([
      "new-newer", "new-older", "earned-newer", "earned-older",
    ]);
  });

  it("keeps ties and uncounted locked achievements in a predictable order", () => {
    const views = [
      achievement({ key: "giant_slayer" }),
      achievement({ key: "winnings_5000", progress: { value: 0, goal: 5000, toGo: 5000, close: false } }),
      achievement({ key: "streak_10" }),
      achievement({ key: "first_tournament_win" }),
      achievement({ key: "winnings_1000", progress: { value: 0, goal: 1000, toGo: 1000, close: false } }),
    ];
    expect(orderAchievements(views).map((view) => view.key)).toEqual([
      "winnings_1000", "winnings_5000", "first_tournament_win", "streak_10", "giant_slayer",
    ]);
  });

  it("hides progress and New on someone else's profile", () => {
    const views = buildAchievements({
      unlocked: [{ achievement_key: "champion_x3", unlocked_at: "2026-09-24 10:00:00" }],
      careerWinnings: 986, fresh: ["champion_x3"], isOwner: false,
    });
    expect(views.find((v) => v.key === "champion_x3")!.state).toBe("on");
    expect(views.every((v) => v.progress === null)).toBe(true);
    expect(views.slice(0, 3).map((v) => v.key)).toEqual(["champion_x3", "winnings_1000", "winnings_5000"]);
  });

  it("lights nothing on a device's first visit", () => {
    expect(freshUnlocks(null, ["a", "b"])).toEqual([]);
    expect(freshUnlocks('["a"]', ["a", "b"])).toEqual(["b"]);
    expect(freshUnlocks("garbage", ["a"])).toEqual([]);
  });
});
