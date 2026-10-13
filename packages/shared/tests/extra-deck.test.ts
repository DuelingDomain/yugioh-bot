import { describe, expect, it } from "vitest";
import { assertExtraDeckCards, isExtraDeckCard, routeDeckSections } from "../src/duels/extra-deck.js";

describe("Extra Deck card rule", () => {
  it.each([
    ["Normal Monster", 0x11, false], ["Effect Monster", 0x21, false],
    ["Ritual Effect Monster", 0xa1, false], ["Pendulum Effect Monster", 0x1000021, false],
    ["Pendulum Normal Monster", 0x1000011, false], ["Spell Card", 0x2, false],
    ["Trap Card", 0x4, false], ["Token", 0x4001, false], ["Skill Card", 0x8000000, false],
    ["Fusion Monster", 0x41, true], ["Synchro Monster", 0x2001, true],
    ["XYZ Monster", 0x800001, true], ["Link Monster", 0x4000001, true],
    ["Fusion Pendulum Effect Monster", 0x1000061, true],
    ["Synchro Pendulum Effect Monster", 0x1002021, true],
    ["XYZ Pendulum Effect Monster", 0x1800021, true],
  ])("classifies %s from fields and bits", (type, bits, extra) => {
    expect(isExtraDeckCard({ type: type as string })).toBe(extra);
    expect(isExtraDeckCard({ type: bits as number })).toBe(extra);
  });
  it("rejects missing, contradictory, token and skill metadata", () => {
    expect(isExtraDeckCard(undefined)).toBe(false);
    expect(isExtraDeckCard({ type: "Spell Card", frameType: "fusion" })).toBe(false);
    expect(isExtraDeckCard({ type: "Trap Card", frameType: "xyz_pendulum" })).toBe(false);
    for (const type of [0x42, 0x45, 0x4041, 0x8000041, "Fusion Token", "Link Skill Card"]) {
      expect(isExtraDeckCard({ type })).toBe(false);
    }
  });
  it("keeps cards with unknown types in their source section and reports their names", () => {
    const cards = new Map([[997, { name: "Named unknown", type: "" }], [998, { name: "Unclassified", type: 0 }]]);
    const deck = { main: [997], extra: [997, 998, 999], side: [999] };
    const routed = routeDeckSections(deck, code => cards.get(code));
    expect(routed.deck).toEqual(deck);
    expect(routed.moves).toEqual([]);
    expect(routed.messages.join(" ")).toContain("Named unknown");
    expect(routed.messages.join(" ")).toContain("Unclassified");
    expect(routed.messages.join(" ")).toContain("card 999");
    expect(() => assertExtraDeckCards(deck, code => cards.get(code))).toThrow("Named unknown");
  });
  it("routes both directions, keeps Side and Master, and reports each copy without a size cap", () => {
    const cards = new Map([[901, { type: "Spell Card", name: "Test Spell" }],
      [902, { type: "Trap Card", name: "Test Trap" }], [903, { type: "Fusion Monster", name: "Test Fusion" }]]);
    const original = { main: [...Array(60).fill(901), 903], extra: [901, 902, 901, 903], side: [903, 902], deckMaster: 903 };
    const result = routeDeckSections(original, code => cards.get(code));
    expect(result.deck.main).toHaveLength(63);
    expect(result.deck.extra).toEqual([903, 903]);
    expect(result.deck.side).toEqual(original.side);
    expect(result.deck.deckMaster).toBe(903);
    expect(result.moves).toHaveLength(4);
    expect(result.messages).toContain("3 cards moved from Extra Deck to Main Deck: Test Spell, Test Trap, Test Spell.");
    expect(original.extra).toEqual([901, 902, 901, 903]);
  });
});
