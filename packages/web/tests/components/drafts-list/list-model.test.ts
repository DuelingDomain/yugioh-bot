import { describe, expect, it } from "vitest";
import {
  formatDay,
  groupDrafts,
  listSummaryParts,
  liveTrack,
  parseDraftConfig,
  pickLabel,
  playersLabel,
  type DraftListItem,
} from "@/components/draft/list/drafts-list-model";

function item(over: Partial<DraftListItem> = {}): DraftListItem {
  return {
    id: 1,
    name: "D",
    status: "active",
    playerCount: 6,
    wave: 2,
    pick: 4,
    config: parseDraftConfig(JSON.stringify({ packsPerPlayer: 3, packSize: 8, pickSeconds: 45 })),
    ...over,
  };
}

describe("parseDraftConfig", () => {
  it("reads saved fields and falls back to the service defaults", () => {
    expect(parseDraftConfig(JSON.stringify({ mode: "theme", cardsPerPlayer: 40, extraDeckEnabled: false }))).toMatchObject({
      mode: "theme",
      cardsPerPlayer: 40,
      extraDeckEnabled: false,
      pickSeconds: 45,
      packsPerPlayer: 5,
    });
    expect(parseDraftConfig("not json").mode).toBe("booster");
    expect(parseDraftConfig(null).packSize).toBe(8);
  });
});

describe("labels", () => {
  it("never says 1 players", () => {
    expect(playersLabel(1)).toBe("1 player");
    expect(playersLabel(0)).toBe("0 players");
    expect(playersLabel(6)).toBe("6 players");
  });
  it("formats the pick time", () => {
    expect(pickLabel(45)).toBe("45 s a pick");
    expect(pickLabel(0)).toBeNull();
  });
});

describe("liveTrack", () => {
  it("cube draft: pack and pick are one-based", () => {
    const t = liveTrack(item());
    expect(t.stations.map((s) => s.code)).toEqual(["LB", "DR", "DK"]);
    expect(t.stations[1].name).toBe("Pack 2 of 3");
    expect(t.current).toBe(1);
    expect(t.caption).toEqual(["Pack 2 of 3", "pick 4"]);
  });
  it("cube draft: clamps a stray wave into range", () => {
    expect(liveTrack(item({ wave: 0, pick: 0 })).caption).toEqual(["Pack 1 of 3", "pick 1"]);
    expect(liveTrack(item({ wave: 9 })).caption[0]).toBe("Pack 3 of 3");
  });
  const theme = (over: Partial<DraftListItem>, cfg: object = {}) =>
    item({ config: parseDraftConfig(JSON.stringify({ mode: "theme", cardsPerPlayer: 40, extraDeckEnabled: true, extraDeckSize: 15, ...cfg })), ...over });
  it("theme draft: main deck round", () => {
    const t = liveTrack(theme({ wave: 12 }));
    expect(t.stations.map((s) => s.code)).toEqual(["LB", "MN", "EX", "DK"]);
    expect(t.current).toBe(1);
    expect(t.caption).toEqual(["Round 12 of 55", "main deck"]);
  });
  it("theme draft: extra deck rounds start after cardsPerPlayer", () => {
    expect(liveTrack(theme({ wave: 40 })).current).toBe(1);
    const t = liveTrack(theme({ wave: 41 }));
    expect(t.current).toBe(2);
    expect(t.caption).toEqual(["Round 41 of 55", "Extra deck"]);
  });
  it("theme draft without an Extra deck has no EX stop", () => {
    const t = liveTrack(theme({ wave: 5 }, { extraDeckEnabled: false }));
    expect(t.stations.map((s) => s.code)).toEqual(["LB", "MN", "DK"]);
    expect(t.caption).toEqual(["Round 5 of 40", "main deck"]);
  });
});

describe("groupDrafts", () => {
  it("splits by status and sorts finished newest first by ended_at ?? created_at", () => {
    const g = groupDrafts([
      item({ id: 1, status: "active" }),
      item({ id: 2, status: "pending" }),
      item({ id: 3, status: "completed", createdAt: "2026-01-01 00:00:00", endedAt: "2026-01-05T10:00:00.000Z" }),
      item({ id: 4, status: "cancelled", createdAt: "2026-01-09 00:00:00" }),
      item({ id: 5, status: "completed", createdAt: "2026-01-02 00:00:00", endedAt: "2026-01-03 00:00:00" }),
    ]);
    expect(g.live.map((d) => d.id)).toEqual([1]);
    expect(g.waiting.map((d) => d.id)).toEqual([2]);
    expect(g.finished.map((d) => d.id)).toEqual([4, 3, 5]);
  });
  it("summary leaves out zero parts", () => {
    expect(listSummaryParts({ live: [], waiting: [item()], finished: [item(), item()] })).toEqual(["1 waiting to start", "2 finished"]);
    expect(listSummaryParts({ live: [], waiting: [], finished: [] })).toEqual([]);
  });
});

describe("formatDay", () => {
  it("parses SQLite and ISO stamps as UTC", () => {
    expect(formatDay("2026-10-01 23:30:00", true)).toBe("Thu, Oct 1");
    expect(formatDay("2026-09-28T12:00:00.000Z")).toBe("Sep 28");
    expect(formatDay(undefined)).toBeNull();
    expect(formatDay("garbage")).toBeNull();
  });
});
