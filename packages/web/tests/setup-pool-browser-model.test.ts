import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  cardGroup,
  chipGroups,
  countsLine,
  entriesOf,
  filterEntries,
  findInRows,
  groupEntries,
  gridMetrics,
  idsInRows,
  layoutRows,
  levelCurve,
  navigate,
  neighborAfterRemoval,
  sortEntries,
  statFacts,
  summarize,
  tallyGroups,
  textBlocks,
  type PoolCard,
} from "@/components/draft/setup/pool-browser-model";

const CARDS: Record<number, PoolCard> = {
  1: { id: 1, name: "Dark Magician", type: "Normal Monster", frameType: "normal", attribute: "DARK", level: 7, atk: 2500, def: 2100 },
  2: { id: 2, name: "Sangan", type: "Effect Monster", frameType: "effect", attribute: "DARK", level: 3, atk: 1000, def: 600 },
  3: { id: 3, name: "Pot of Greed", type: "Spell Card", frameType: "spell" },
  4: { id: 4, name: "Mirror Force", type: "Trap Card", frameType: "trap" },
  5: { id: 5, name: "Stardust Dragon", type: "Synchro Monster", frameType: "synchro", level: 8, atk: 2500, def: 2000 },
  6: { id: 6, name: "Number 39", type: "XYZ Monster", frameType: "xyz", level: 4, atk: 2500, def: 2000 },
  7: { id: 7, name: "Link Spider", type: "Link Monster", frameType: "link", atk: 1400 },
};
const get = (id: number) => CARDS[id];

const main = new Map([
  [1, 3],
  [2, 1],
  [3, 2],
  [4, 1],
]);
const extra = new Map([
  [5, 1],
  [6, 2],
  [7, 1],
]);

describe("pool browser model", () => {
  it("sorts cards into groups", () => {
    expect(cardGroup(CARDS[1])).toBe("monster");
    expect(cardGroup(CARDS[3])).toBe("spell");
    expect(cardGroup(CARDS[4])).toBe("trap");
    expect(cardGroup(CARDS[5])).toBe("synchro");
    expect(cardGroup(CARDS[6])).toBe("xyz");
    expect(cardGroup(CARDS[7])).toBe("link");
    expect(cardGroup(undefined)).toBe("unknown");
  });

  it("counts copies and unique cards, and skips empty entries", () => {
    const entries = entriesOf(new Map([...main, [9, 0]]), "main", get);
    expect(entries.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(summarize(entries)).toMatchObject({ copies: 7, distinct: 4 });
    expect(countsLine(1, 1)).toBe("1 card · 1 unique");
    expect(countsLine(7, 4)).toBe("7 cards · 4 unique");
    expect(entriesOf(undefined, "extra", get)).toEqual([]);
  });

  it("weights chips by copies", () => {
    const tally = tallyGroups(entriesOf(main, "main", get));
    expect(tally).toMatchObject({ monster: 4, spell: 2, trap: 1 });
    expect(chipGroups("main")).toEqual(["monster", "spell", "trap"]);
    expect(chipGroups("extra")).toEqual(["fusion", "synchro", "xyz", "link"]);
    expect(chipGroups("split")).toHaveLength(7);
  });

  it("filters by query, chip, copies and tribute", () => {
    const entries = entriesOf(main, "main", get);
    expect(filterEntries(entries, { ...NO_FILTERS, query: "magic" }).map((e) => e.id)).toEqual([1]);
    expect(filterEntries(entries, { ...NO_FILTERS, query: "spell" }).map((e) => e.id)).toEqual([3]);
    expect(filterEntries(entries, { ...NO_FILTERS, chip: "trap" }).map((e) => e.id)).toEqual([4]);
    expect(filterEntries(entries, { ...NO_FILTERS, copies: "multi" }).map((e) => e.id)).toEqual([1, 3]);
    expect(filterEntries(entries, { ...NO_FILTERS, copies: "three" }).map((e) => e.id)).toEqual([1]);
    expect(filterEntries(entries, { ...NO_FILTERS, tribute: "none" }).map((e) => e.id)).toEqual([2]);
    expect(filterEntries(entries, { ...NO_FILTERS, tribute: "two" }).map((e) => e.id)).toEqual([1]);
  });

  it("sorts by name, level, copies and added order", () => {
    const entries = entriesOf(main, "main", get);
    expect(sortEntries(entries, "name").map((e) => e.id)).toEqual([1, 4, 3, 2]);
    expect(sortEntries(entries, "copies")[0].id).toBe(1);
    expect(sortEntries(entries, "level")[0].id).toBeDefined();
    expect(sortEntries(entries, "added").map((e) => e.id)).toEqual([4, 3, 2, 1]);
  });

  it("groups by type, level and none", () => {
    const entries = entriesOf(main, "main", get);
    expect(groupEntries(entries, "type", "main").map((s) => [s.label, s.copies])).toEqual([
      ["Monsters", 4],
      ["Spells", 2],
      ["Traps", 1],
    ]);
    const byLevel = groupEntries(entries, "level", "main");
    expect(byLevel.map((s) => s.key)).toEqual(["L3", "L7", "st"]);
    expect(groupEntries(entries, "none", "main")).toHaveLength(1);
  });

  it("builds the level curve from copies", () => {
    const curve = levelCurve(entriesOf(main, "main", get), "main");
    expect(curve.counts[2]).toBe(1);
    expect(curve.counts[6]).toBe(3);
    expect(curve.max).toBe(3);
    const ec = levelCurve(entriesOf(extra, "extra", get), "extra");
    expect(ec.counts[7]).toBe(1);
    expect(ec.counts[3]).toBe(2);
    expect(ec.counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("flattens sections into rows and honors collapsed sections", () => {
    const entries = entriesOf(new Map(Array.from({ length: 7 }, (_, i) => [100 + i, 1] as [number, number])), "main", () => undefined);
    const sections = groupEntries(entries, "none", "main");
    const rows = layoutRows(sections, 3, () => false);
    expect(rows.map((r) => r.kind)).toEqual(["header", "cards", "cards", "cards"]);
    expect(idsInRows(rows)).toHaveLength(7);
    expect(layoutRows(sections, 3, () => true).map((r) => r.kind)).toEqual(["header"]);
    expect(findInRows(rows, 106)).toMatchObject({ row: 3, col: 0 });
  });

  it("moves between cards with the arrow keys", () => {
    const entries = entriesOf(new Map(Array.from({ length: 7 }, (_, i) => [100 + i, 1] as [number, number])), "main", () => undefined);
    const rows = layoutRows(groupEntries(entries, "none", "main"), 3, () => false);
    expect(navigate(rows, 100, "ArrowRight")?.id).toBe(101);
    expect(navigate(rows, 102, "ArrowRight")?.id).toBe(103);
    expect(navigate(rows, 103, "ArrowLeft")?.id).toBe(102);
    expect(navigate(rows, 101, "ArrowDown")?.id).toBe(104);
    expect(navigate(rows, 105, "ArrowDown")?.id).toBe(106);
    expect(navigate(rows, 104, "ArrowUp")?.id).toBe(101);
    expect(navigate(rows, 100, "ArrowUp")?.id).toBe(100);
    expect(navigate(rows, 103, "Home")?.id).toBe(100);
    expect(navigate(rows, 100, "End")?.id).toBe(106);
    expect(navigate(rows, 999, "Home")).toBeNull();
  });

  it("picks a neighbor after a card is removed", () => {
    expect(neighborAfterRemoval([1, 2, 3], [1, 3], 2)).toBe(3);
    expect(neighborAfterRemoval([1, 2, 3], [1, 2], 3)).toBe(2);
    expect(neighborAfterRemoval([1], [], 1)).toBeNull();
  });

  it("sizes tiles exactly", () => {
    const g = gridMetrics("grid", 800, 104);
    expect(g.perRow).toBeGreaterThanOrEqual(6);
    expect(g.rowHeight).toBe(g.cellHeight + 8);
    expect(gridMetrics("grid", 10, 104).perRow).toBe(1);
    expect(gridMetrics("list", 800, 104).perRow).toBe(2);
    expect(gridMetrics("list", 400, 104).perRow).toBe(1);
  });

  it("describes stats and card text", () => {
    expect(statFacts(CARDS[1], "main").map((f) => f.label)).toEqual(["ATK", "DEF", "Level"]);
    expect(statFacts(CARDS[6], "extra").map((f) => f.label)).toEqual(["ATK", "DEF", "Rank"]);
    expect(statFacts(CARDS[7], "extra").map((f) => f.label)).toEqual(["ATK"]);
    expect(statFacts(CARDS[3], "main").map((f) => f.label)).toEqual(["Type", "Deck"]);
    expect(textBlocks("[ Monster Effect ]\nDraw 1 card.\n\nDiscard 1.")).toEqual([
      { heading: true, text: "Monster Effect" },
      { heading: false, text: "Draw 1 card." },
      { heading: false, text: "Discard 1." },
    ]);
    expect(textBlocks(undefined)).toEqual([]);
  });
});
