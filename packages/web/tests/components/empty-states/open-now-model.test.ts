import { describe, expect, it } from "vitest";
import { EMPTY_OPEN_NOW } from "@/lib/open-now";
import { hasOpenRows, openNowRows, parseOpenNow } from "@/components/empty-states/open-now-model";
import { OPEN_DRAFT, OPEN_TOURNAMENT } from "../../fixtures/open-now";

describe("parseOpenNow", () => {
  it("accepts the API shape and rejects anything else", () => {
    expect(parseOpenNow({ tournaments: [OPEN_TOURNAMENT], drafts: [OPEN_DRAFT], duelsInProgress: 1 })).not.toBeNull();
    expect(parseOpenNow(EMPTY_OPEN_NOW)).toEqual(EMPTY_OPEN_NOW);
    for (const bad of [null, "x", {}, { tournaments: [], drafts: [] }, { tournaments: [{}], drafts: [], duelsInProgress: 0 }, { tournaments: [], drafts: [], duelsInProgress: "2" }]) {
      expect(parseOpenNow(bad)).toBeNull();
    }
  });
});

describe("openNowRows", () => {
  it("builds real rows with links to the slugs, tournaments first", () => {
    const rows = openNowRows({ tournaments: [OPEN_TOURNAMENT], drafts: [OPEN_DRAFT], duelsInProgress: 0 });
    expect(rows.join.map((r) => r.href)).toEqual(["/tournament/spring-cup", "/draft/cube-night"]);
    expect(rows.join.map((r) => r.action)).toEqual(["Join tournament", "Join draft"]);
    expect(rows.watch).toBeNull();
    expect(hasOpenRows(rows)).toBe(true);
  });

  it("skips rows the viewer already joined and caps the list at five", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...OPEN_DRAFT, slug: `d${i}` }));
    expect(openNowRows({ ...EMPTY_OPEN_NOW, drafts: [{ ...OPEN_DRAFT, viewerJoined: true }] }).join).toEqual([]);
    expect(openNowRows({ ...EMPTY_OPEN_NOW, drafts: many }).join).toHaveLength(5);
  });

  it("can leave a kind out and counts duels as the watch row", () => {
    const rows = openNowRows({ tournaments: [OPEN_TOURNAMENT], drafts: [], duelsInProgress: 3 }, ["drafts"]);
    expect(rows.join).toEqual([]);
    expect(rows.watch).toMatchObject({ href: "/duels" });
    expect(rows.watch?.label).toBe("3 duels in progress");
    expect(hasOpenRows(rows)).toBe(true);
    expect(hasOpenRows(openNowRows(EMPTY_OPEN_NOW))).toBe(false);
  });
});
