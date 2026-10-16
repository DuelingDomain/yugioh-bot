import { describe, expect, it } from "vitest";
import { CARD_TYPE_BITS as T } from "../../src/duels/card-query.js";
import { checkGenesysDeck, genesysDeckPoints, isGenesysForbiddenType, type GenesysCard } from "../../src/duels/genesys.js";

const monster = T.monster | T.effect;
function catalog() {
  return new Map<number, GenesysCard>([
    [1, { name: "Original", type: monster, genesysPoints: 20 }],
    [2, { name: " original ", type: monster, alias: 1, genesysPoints: null }],
    [3, { name: "Free", type: T.spell, genesysPoints: 0 }],
    [4, { name: "Fusion", type: monster | T.fusion, genesysPoints: 15 }],
    [5, { name: "Link", type: monster | T.link, genesysPoints: 10 }],
    [6, { name: "Pendulum", type: monster | T.pendulum, genesysPoints: 0 }],
    [7, { name: "Unknown", type: monster, genesysPoints: null }],
    [8, { name: "Different alias", type: monster, alias: 1, genesysPoints: 5 }],
  ]);
}

describe("Genesys rules", () => {
  it.each([
    [monster | T.link, true], [monster | T.pendulum | T.fusion, true],
    [monster | T.pendulum | T.xyz, true], [monster | T.fusion, false], [T.spell, false],
    ["Link Monster", true], ["Pendulum Effect Monster", true], ["XYZ Pendulum Effect Monster", true],
    ["Effect Monster", false], ["Spell Card", false],
  ])("classifies forbidden types: %s", (type, forbidden) => {
    expect(isGenesysForbiddenType({ type })).toBe(forbidden);
  });

  it("counts every copy in Main, Extra, Side and Master, using artwork identity", () => {
    const deck = { main: [1, 2, 3], extra: [4], side: [2, 8], deckMaster: 1 };
    expect(genesysDeckPoints(deck, catalog())).toEqual({ totalPoints: 100, knownPoints: 100, unknownCards: [] });
    expect(checkGenesysDeck(deck, catalog(), { pointCap: 100 })).toMatchObject({ valid: true, totalPoints: 100, problems: [] });
    expect(checkGenesysDeck(deck, catalog(), { pointCap: 99 })).toMatchObject({
      valid: false, problems: [{ kind: "over-cap", pointCap: 99, totalPoints: 100 }],
    });
  });

  it("accepts an all-zero deck at cap zero", () => {
    expect(checkGenesysDeck({ main: [3, 3], extra: [], side: [] }, catalog(), { pointCap: 0 })).toMatchObject({
      valid: true, totalPoints: 0, knownPoints: 0, problems: [],
    });
  });

  it.each(["main", "extra", "side", "deckMaster"] as const)("forbids Link and Pendulum in %s", section => {
    for (const code of [5, 6]) {
      const deck = { main: [], extra: [], side: [], [section]: section === "deckMaster" ? code : [code] };
      const result = checkGenesysDeck(deck, catalog(), { pointCap: 100 });
      expect(result.valid).toBe(false);
      expect(result.problems).toMatchObject([{ kind: "forbidden-type", cards: [{ section, index: 0, code }] }]);
    }
  });

  it("fails closed on missing or invalid points while reporting a known subtotal", () => {
    const cards = catalog();
    for (const genesysPoints of [undefined, null, -1, 1.5, NaN, Infinity]) {
      cards.set(7, { name: "Unknown", type: monster, genesysPoints });
      const deck = { main: [1, 7, 999], extra: [], side: [], deckMaster: 7 };
      const result = checkGenesysDeck(deck, cards, { pointCap: 10 });
      expect(result).toMatchObject({ valid: false, totalPoints: null, knownPoints: 20 });
      expect(result.problems).toMatchObject([
        { kind: "unknown-points", cards: [{ code: 7, section: "main", index: 1 }, { code: 999, section: "main", index: 2 }, { code: 7, section: "deckMaster", index: 0 }] },
        { kind: "over-cap", totalPoints: 20, pointCap: 10 },
      ]);
      expect(result.problems[0]?.message).toMatch(/unknown.*points|points.*unknown/i);
    }
  });

  it("does not replace unknown canonical points with an artwork's stale points", () => {
    const cards = catalog();
    cards.set(1, { name: "Original", type: monster, genesysPoints: null });
    cards.set(2, { name: "Original", type: monster, alias: 1, genesysPoints: 0 });
    expect(genesysDeckPoints({ main: [2], extra: [], side: [] }, cards).totalPoints).toBeNull();
  });

  it("keeps different-type aliases and alias cycles distinct", () => {
    const cards = catalog();
    cards.set(2, { name: "Original", type: monster | T.fusion, alias: 1, genesysPoints: 3 });
    expect(genesysDeckPoints({ main: [2], extra: [], side: [] }, cards).totalPoints).toBe(3);
    cards.set(1, { name: "Original", type: monster, alias: 2, genesysPoints: 20 });
    cards.set(2, { name: "Original", type: monster, alias: 1, genesysPoints: 3 });
    expect(genesysDeckPoints({ main: [1, 2], extra: [], side: [] }, cards).totalPoints).toBe(23);
  });
});
