import { describe, expect, it } from "vitest";
import { LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_REMOVED, zoneKey } from "../src/components/duel/constants";
import { pileSummonTone } from "../src/components/duel/summon-circle-model";

const extraKeys = [0, 1, 2].map((seq) => zoneKey(0, LOCATION_EXTRA, seq));
const graveKeys = [0, 1].map((seq) => zoneKey(0, LOCATION_GRAVE, seq));

describe("pileSummonTone", () => {
  it("shows the Extra Deck circle when one Extra Deck card is legal", () => {
    const legal = new Set([zoneKey(0, LOCATION_EXTRA, 1)]);
    expect(pileSummonTone({ kind: "extra", side: "you", count: 3, keys: extraKeys, legalKeys: legal })).toBe("extra");
  });

  it("shows the GY circle when one GY card is legal", () => {
    const legal = new Set([zoneKey(0, LOCATION_GRAVE, 0)]);
    expect(pileSummonTone({ kind: "gy", side: "you", count: 2, keys: graveKeys, legalKeys: legal })).toBe("gy");
  });

  it("shows the Banished circle when a banished card is legal", () => {
    const keys = [zoneKey(0, LOCATION_REMOVED, 0)];
    expect(pileSummonTone({ kind: "banish", side: "you", count: 1, keys, legalKeys: new Set(keys) })).toBe("banish");
  });

  it("shows nothing when no card of the pile is legal", () => {
    const legal = new Set([zoneKey(0, LOCATION_GRAVE, 0)]);
    expect(pileSummonTone({ kind: "extra", side: "you", count: 3, keys: extraKeys, legalKeys: legal })).toBeNull();
    expect(pileSummonTone({ kind: "gy", side: "you", count: 2, keys: graveKeys, legalKeys: new Set() })).toBeNull();
  });

  it("shows nothing for the opponent's piles", () => {
    const legal = new Set(extraKeys);
    expect(pileSummonTone({ kind: "extra", side: "opp", count: 3, keys: extraKeys, legalKeys: legal })).toBeNull();
  });

  it("shows nothing for an empty pile, even when its placeholder key is legal", () => {
    const keys = [zoneKey(0, LOCATION_GRAVE, 0)];
    expect(pileSummonTone({ kind: "gy", side: "you", count: 0, keys, legalKeys: new Set(keys) })).toBeNull();
  });

  it("shows nothing for piles without a circle (deck, field)", () => {
    const keys = [zoneKey(0, 1, 0)];
    expect(pileSummonTone({ kind: "deck", side: "you", count: 5, keys, legalKeys: new Set(keys) })).toBeNull();
    expect(pileSummonTone({ kind: "field", side: "you", count: 1, keys, legalKeys: new Set(keys) })).toBeNull();
  });
});
