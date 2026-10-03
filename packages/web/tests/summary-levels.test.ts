import { describe, expect, it } from "vitest";
import { buildLevelsModel } from "../src/components/draft/summary/levels";
import { groupPool, kindTally } from "../src/components/draft/summary/groups";
import { formatDuration } from "../src/components/draft/summary/format";
import type { CardSummary } from "../src/lib/card-types";

const mon = (level: number, over: Partial<CardSummary> = {}): CardSummary => ({
  id: level, name: `L${level}`, type: "Effect Monster", frameType: "effect", effectText: "", imageUrl: "", imageUrlSmall: "", level, ...over,
});

describe("buildLevelsModel", () => {
  it("bands main deck monsters and ignores Extra deck monsters", () => {
    const cards = [mon(1), mon(4), mon(4), mon(5), mon(7), mon(8), mon(10), mon(6, { type: "Synchro Monster", frameType: "synchro" })];
    const m = buildLevelsModel(cards);
    expect(m.bands.map((b) => b.total)).toEqual([3, 1, 3]);
    expect(m.bands[0].bars.map((b) => b.count)).toEqual([1, 0, 0, 2]);
    expect(m.bands[2].bars.map((b) => [b.label, b.count])).toEqual([["7", 1], ["8+", 2]]);
    expect(m.total).toBe(7);
    expect(m.ariaLabel).toBe("Main deck monsters by level: 3 need no tribute, 1 needs one tribute, 3 need two tributes");
  });

  it("draws empty bars as zero and scales heights", () => {
    const m = buildLevelsModel([mon(4), mon(4), mon(2)]);
    expect(m.bands[1].bars.every((b) => b.count === 0 && b.height === 0)).toBe(true);
    expect(m.bands[0].bars[3].height).toBe(1);
    expect(m.bands[0].bars[1].height).toBeCloseTo(0.5);
    expect(buildLevelsModel([]).total).toBe(0);
  });
});

describe("groupPool", () => {
  const spell = { ...mon(0), id: 100, type: "Spell Card", frameType: "spell", level: undefined };
  const trap = { ...mon(0), id: 101, type: "Trap Card", frameType: "trap", level: undefined };
  const extra = mon(5, { id: 102, type: "Xyz Monster", frameType: "xyz" });
  const cards = [mon(4), spell, trap, extra];
  it("groups cube pools by kind and theme pools into main/extra", () => {
    expect(groupPool(cards, "cube").map((g) => g.title)).toEqual(["Monsters", "Spells", "Traps", "Extra deck"]);
    const t = groupPool(cards, "theme");
    expect(t.map((g) => [g.title, g.cards.length])).toEqual([["Main deck", 3], ["Extra deck", 1]]);
    expect(kindTally(cards)).toEqual({ monster: 1, spell: 1, trap: 1, extra: 1 });
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration("2026-01-01T10:00:00Z", "2026-01-01T10:52:00Z")).toBe("52 min");
    expect(formatDuration("2026-01-01T10:00:00Z", "2026-01-01T11:05:00Z")).toBe("1 h 5 min");
    expect(formatDuration("2026-01-01T10:00:00Z", "2026-01-01T12:00:00Z")).toBe("2 h");
    expect(formatDuration(undefined, "2026-01-01T12:00:00Z")).toBeNull();
  });
});
