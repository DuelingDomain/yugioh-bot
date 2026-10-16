import { describe, expect, it } from "vitest";
import type { DuelDeck, GenesysCard, SavedDeck } from "@yugidraft/shared/duels";
import {
  genesysPlainLine,
  savedDeckCodes,
  savedDeckGenesysPick,
} from "../src/components/duel/saved-deck-genesys";
import { genesysDeckRows } from "../src/components/duel/saved-deck-genesys-list";

const MONSTER = 0x1;
const LINK = 0x4000000;
const PENDULUM = 0x1000000;

const card = (name: string, genesysPoints: number | null | undefined, type = MONSTER): GenesysCard => ({
  name,
  type,
  ...(genesysPoints === undefined ? {} : { genesysPoints }),
});

const catalog = new Map<number, GenesysCard>([
  [1, card("Free", 0)],
  [2, card("Five", 5)],
  [3, card("Twenty", 20)],
  [4, card("Unknown", undefined)],
  [5, card("Linker", 0, LINK)],
  [6, card("Pend", 3, PENDULUM)],
]);
const deck = (parts: Partial<DuelDeck>): DuelDeck => ({ main: [], extra: [], side: [], ...parts });
const loaded = new Set([1, 2, 3, 4, 5, 6]);
const pick = (d: DuelDeck, cap: number, mode: "normal" | "domain" = "normal", settled: ReadonlySet<number> = loaded) =>
  savedDeckGenesysPick(d, mode, catalog, { pointCap: cap }, settled);

describe("saved deck pick state in a Genesys room", () => {
  it("is valid and pickable at or below the cap", () => {
    const result = pick(deck({ main: [3, 3, 2, 1] }), 45);
    expect(result).toMatchObject({ state: "valid", selectable: true, pointsText: "45 / 45 pts", label: "Valid", reason: null });
    expect(pick(deck({ main: [3, 3, 2, 1] }), 100).selectable).toBe(true);
  });

  it("counts Main, Extra and Side copies", () => {
    const result = pick(deck({ main: [2], extra: [2], side: [2] }), 100);
    expect(result.totalText).toBe("15");
  });

  it("blocks a deck over the cap and says by how much", () => {
    const result = pick(deck({ main: [3, 3, 3] }), 50);
    expect(result).toMatchObject({ state: "over", selectable: false, label: "Over cap by 10", pointsText: "60 / 50 pts" });
    expect(result.reason).toContain("10 points over");
  });

  it("is pickable at once when the cap is raised to fit", () => {
    const d = deck({ main: [3, 3, 3] });
    expect(pick(d, 59).selectable).toBe(false);
    expect(pick(d, 60).selectable).toBe(true);
  });

  it("blocks Link and Pendulum Monsters whatever the cap", () => {
    for (const code of [5, 6]) {
      const result = pick(deck({ main: [1], extra: [code] }), 1000);
      expect(result).toMatchObject({ state: "forbidden", selectable: false, label: "Has Link or Pendulum" });
    }
  });

  it("never counts unknown points as 0", () => {
    const result = pick(deck({ main: [2, 4] }), 100);
    expect(result).toMatchObject({ state: "unknown", selectable: false, label: "Unknown points", totalText: "5+" });
    // Even a huge cap does not make unknown points valid.
    expect(pick(deck({ main: [4] }), 1000).selectable).toBe(false);
    // A card the lookup did not find at all is unknown, not zero.
    expect(pick(deck({ main: [99] }), 1000, "normal", new Set([99])).state).toBe("unknown");
  });

  it("is not pickable while cards are loading, and when the lookup failed", () => {
    const waiting = savedDeckGenesysPick(deck({ main: [2] }), "normal", new Map(), { pointCap: 100 });
    expect(waiting).toMatchObject({ state: "loading", selectable: false, label: "Counting points…" });
    const failed = savedDeckGenesysPick(deck({ main: [2] }), "normal", new Map(), { pointCap: 100 }, new Set([2]), true);
    expect(failed).toMatchObject({ state: "failed", selectable: false, label: "Unknown points" });
  });

  it("counts the Deck Master in Genesys Domain only", () => {
    const d = deck({ main: [2], deckMaster: 3 });
    expect(pick(d, 24, "domain")).toMatchObject({ state: "over", pointsText: "25 / 24 pts" });
    expect(pick(d, 24, "normal")).toMatchObject({ state: "valid", pointsText: "5 / 24 pts" });
    expect(pick(deck({ main: [1], deckMaster: 5 }), 100, "domain").state).toBe("forbidden");
  });

  it("an empty cap of 0 allows only 0-point cards", () => {
    expect(pick(deck({ main: [1, 1] }), 0).selectable).toBe(true);
    expect(pick(deck({ main: [1, 2] }), 0).selectable).toBe(false);
  });

  it("puts a Link first when it is also over the cap", () => {
    expect(pick(deck({ main: [3, 3, 5] }), 10).state).toBe("forbidden");
  });
});

describe("saved deck rows", () => {
  const saved = (id: number, mode: SavedDeck["mode"], main: number[], tagged = false): SavedDeck => ({
    id, name: `Deck ${id}`, mode, deck: deck({ main }), createdAt: "", updatedAt: "",
    ...(tagged ? { genesys: { pointCap: 100 } } : {}),
  });

  it("judges decks of the room format and lists the other format as not usable", () => {
    const rows = genesysDeckRows(
      [saved(1, "normal", [2]), saved(2, "domain", [2]), saved(3, "normal", [3, 3, 3, 3], true)],
      "normal", { pointCap: 50 }, catalog, loaded, false,
    );
    expect(rows.map((row) => row.saved.id)).toEqual([3, 1, 2]);
    expect(rows[0]!.pick).toMatchObject({ state: "over", selectable: false });
    expect(rows[1]!.pick).toMatchObject({ state: "valid", selectable: true });
    expect(rows[2]!.pick).toBeNull();
  });

  it("changes a row to pickable when the cap rises", () => {
    const decks = [saved(1, "normal", [3, 3, 3])];
    const at = (pointCap: number) => genesysDeckRows(decks, "normal", { pointCap }, catalog, loaded, false)[0]!.pick!;
    expect(at(40).selectable).toBe(false);
    expect(at(60).selectable).toBe(true);
  });

  it("lists the codes to look up, with the Deck Master only for Domain", () => {
    const decks = [{ deck: deck({ main: [3, 2], extra: [1], side: [2], deckMaster: 6 }) }];
    expect(savedDeckCodes(decks, "normal")).toEqual([1, 2, 3]);
    expect(savedDeckCodes(decks, "domain")).toEqual([1, 2, 3, 6]);
  });
});

describe("plain line", () => {
  it("explains the format, and the Deck Master in Genesys Domain", () => {
    expect(genesysPlainLine("normal")).toBe("Genesys: each card has points. Your deck total must be at or below the cap. Link and Pendulum Monsters are not allowed.");
    expect(genesysPlainLine("domain")).toContain("In Genesys Domain the Deck Master counts too.");
  });
});
