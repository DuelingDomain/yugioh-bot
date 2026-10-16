import { describe, expect, it } from "vitest";
import type { DuelDeck, GenesysCard } from "@yugidraft/shared/duels";
import {
  DEFAULT_GENESYS_POINT_CAP,
  formatLabel,
  genesysMark,
  genesysTotalText,
  genesysVerdict,
  parsePointCap,
  summarizeGenesys,
} from "../src/components/decks/genesys";
import { isNewDeckDirty, snapshotOf } from "../src/components/decks/model";
import { savedDeckTag } from "../src/components/duel/saved-deck-picker";
import { genesysCatalogFrom } from "../src/components/decks/use-genesys-deck";
import { deckStatus } from "../src/components/decks/library-status";

const MONSTER = 0x1;
const LINK = 0x4000000;
const PENDULUM = 0x1000000;

const card = (name: string, genesysPoints: number | null | undefined, type = MONSTER, alias?: number): GenesysCard => ({
  name,
  type,
  ...(genesysPoints === undefined ? {} : { genesysPoints }),
  ...(alias ? { alias } : {}),
});

const catalog = new Map<number, GenesysCard>([
  [1, card("Free", 0)],
  [2, card("Five", 5)],
  [3, card("Twenty", 20)],
  [4, card("Unknown", undefined)],
  [5, card("Linker", 0, LINK)],
  [6, card("Pend", 3, PENDULUM)],
  [7, card("Five", undefined, MONSTER, 2)],
]);
const deck = (parts: Partial<DuelDeck>): DuelDeck => ({ main: [], extra: [], side: [], ...parts });
const cap = (pointCap: number) => ({ pointCap });

describe("genesys labels and cap", () => {
  it("names the format", () => {
    expect(formatLabel("normal", null)).toBe("Standard");
    expect(formatLabel("domain", undefined)).toBe("Domain");
    expect(formatLabel("normal", cap(100))).toBe("Genesys");
    expect(formatLabel("domain", cap(100))).toBe("Genesys Domain");
  });

  it("takes only whole caps from 0 to 1000", () => {
    expect(DEFAULT_GENESYS_POINT_CAP).toBe(100);
    expect(parsePointCap("100")).toBe(100);
    expect(parsePointCap(" 0 ")).toBe(0);
    expect(parsePointCap("1000")).toBe(1000);
    expect(parsePointCap("1001")).toBeNull();
    expect(parsePointCap("")).toBeNull();
    expect(parsePointCap("-1")).toBeNull();
    expect(parsePointCap("12.5")).toBeNull();
    expect(parsePointCap("1e2")).toBeNull();
  });
});

describe("genesysMark", () => {
  it("shows points only above zero", () => {
    expect(genesysMark({ type: MONSTER, genesysPoints: 7 })).toEqual({ kind: "points", points: 7 });
    expect(genesysMark({ type: MONSTER, genesysPoints: 0 })).toBeNull();
  });

  it("never turns unknown points into zero", () => {
    expect(genesysMark({ type: MONSTER })).toEqual({ kind: "unknown" });
    expect(genesysMark({ type: MONSTER, genesysPoints: null })).toEqual({ kind: "unknown" });
    expect(genesysMark({ type: MONSTER, genesysPoints: -2 })).toEqual({ kind: "unknown" });
    expect(genesysMark(null)).toBeNull();
  });

  it("marks Link and Pendulum as not allowed, whatever their points", () => {
    expect(genesysMark({ type: LINK, genesysPoints: 0 })).toEqual({ kind: "forbidden" });
    expect(genesysMark({ type: PENDULUM | MONSTER, genesysPoints: 9 })).toEqual({ kind: "forbidden" });
  });
});

describe("summarizeGenesys", () => {
  const settled = new Set<number>();

  it("adds every copy in Main, Extra and Side", () => {
    const summary = summarizeGenesys(deck({ main: [2, 2, 3], extra: [1], side: [2] }), "normal", catalog, cap(100), settled);
    expect(summary).toMatchObject({ total: 35, known: 35, over: 0, state: "ok", cap: 100 });
    expect(genesysVerdict(summary)).toEqual({ tone: "ok", flag: "Genesys: 35 of 100 points" });
  });

  it("counts the Deck Master in Domain only", () => {
    const withMaster = deck({ main: [2], deckMaster: 3 });
    expect(summarizeGenesys(withMaster, "domain", catalog, cap(100), settled).known).toBe(25);
    expect(summarizeGenesys(withMaster, "normal", catalog, cap(100), settled).known).toBe(5);
  });

  it("says over the cap with the number of points over", () => {
    const summary = summarizeGenesys(deck({ main: [3, 3, 3, 3, 3, 2] }), "normal", catalog, cap(100), settled);
    expect(summary).toMatchObject({ total: 105, over: 5, state: "over" });
    expect(genesysVerdict(summary)).toEqual({ tone: "bad", flag: "5 points over the Genesys cap" });
  });

  it("is on the cap, not over it, at the cap", () => {
    const summary = summarizeGenesys(deck({ main: [3, 3, 3, 3, 3] }), "normal", catalog, cap(100), settled);
    expect(summary).toMatchObject({ total: 100, over: 0, state: "ok" });
  });

  it("does not show a total when a card has unknown points", () => {
    const summary = summarizeGenesys(deck({ main: [2, 4] }), "normal", catalog, cap(100), new Set([4]));
    expect(summary).toMatchObject({ total: null, known: 5, unknownCount: 1, state: "unknown" });
    expect(genesysTotalText(summary)).toBe("5+");
    expect(genesysVerdict(summary).tone).toBe("warn");
  });

  it("treats a card that has not loaded as pending, not as final", () => {
    const summary = summarizeGenesys(deck({ main: [2, 99] }), "normal", catalog, cap(100), new Set());
    expect(summary).toMatchObject({ pendingCount: 1, unknownCount: 0, state: "pending" });
    const answered = summarizeGenesys(deck({ main: [2, 99] }), "normal", catalog, cap(100), new Set([99]));
    expect(answered).toMatchObject({ pendingCount: 0, unknownCount: 1, state: "unknown" });
  });

  it("lets an artwork use the points of its main card", () => {
    const summary = summarizeGenesys(deck({ main: [7] }), "normal", catalog, cap(100), settled);
    expect(summary).toMatchObject({ total: 5, state: "ok" });
  });

  it("lists Link and Pendulum cards, the Deck Master included, and puts them first in the verdict", () => {
    const summary = summarizeGenesys(deck({ main: [6], extra: [5], deckMaster: 5 }), "domain", catalog, cap(1), settled);
    expect(summary.forbidden.map((ref) => `${ref.section}:${ref.code}`)).toEqual(["main:6", "extra:5", "deckMaster:5"]);
    expect(genesysVerdict(summary)).toEqual({ tone: "bad", flag: "3 cards are not allowed in Genesys" });
  });
});

describe("genesysCatalogFrom", () => {
  it("keeps the alias of an artwork and drops nothing about points", () => {
    const map = genesysCatalogFrom([
      { code: 8, canonicalPasscode: 2, name: "Alt", description: "", type: MONSTER, attack: 0, defense: 0, level: 1, attribute: 1, race: "", genesysPoints: null },
      { code: 2, canonicalPasscode: 2, name: "Five", description: "", type: MONSTER, attack: 0, defense: 0, level: 1, attribute: 1, race: "", genesysPoints: 5 },
    ]);
    expect(map.get(8)).toMatchObject({ alias: 2, genesysPoints: null });
    expect(map.get(2)).toEqual({ name: "Five", type: MONSTER, genesysPoints: 5 });
  });
});

describe("deck snapshot and tag", () => {
  it("keeps the snapshot of an untagged deck as it was, and changes it for a tag or a cap", () => {
    const d = deck({ main: [1] });
    expect(snapshotOf("A", "normal", d)).toBe(JSON.stringify({ name: "A", mode: "normal", deck: d }));
    expect(snapshotOf("A", "normal", d, null)).toBe(snapshotOf("A", "normal", d));
    expect(snapshotOf("A", "normal", d, cap(100))).not.toBe(snapshotOf("A", "normal", d));
    expect(snapshotOf("A", "normal", d, cap(100))).not.toBe(snapshotOf("A", "normal", d, cap(80)));
  });

  it("calls a new Genesys deck changed even when it is empty", () => {
    expect(isNewDeckDirty("Untitled deck", "normal", deck({}), null)).toBe(false);
    expect(isNewDeckDirty("Untitled deck", "normal", deck({}), cap(100))).toBe(true);
  });

  it("labels a tagged deck in the picker and the library", () => {
    expect(savedDeckTag({ genesys: cap(80) })).toBe("Genesys, cap 80");
    expect(savedDeckTag({ genesys: null })).toBe("");
    const fits = deck({ main: Array.from({ length: 40 }, (_, index) => index + 1) });
    expect(deckStatus({ mode: "normal", deck: fits, genesys: cap(100) }).head).toBe("Sizes fit a Genesys table");
    expect(deckStatus({ mode: "normal", deck: fits }).head).toBe("Sizes fit a Standard table");
  });
});
