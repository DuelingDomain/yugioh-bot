import { describe, expect, it } from "vitest";
import { boardWidth, buildCrumble, crumbleCards, mulberry } from "@/components/duel/table/crumble-model";

const view = {
  monsters: [{ code: 1001, position: 1 }, null, null, null, null, null, null],
  spells: [null, { code: 2002, position: 2 }, null, null, null, null],
  hand: [{ code: 3003, position: 1 }, { code: 4004, position: 1 }],
  graveyard: [{ code: 5005, position: 1 }],
  deckCount: 20,
  extraCount: 3,
} as unknown as Parameters<typeof crumbleCards>[0];

describe("crumble model", () => {
  it("is as wide as the board of the master rule", () => {
    expect(boardWidth(5)).toBe(653);
    expect(boardWidth(3)).toBe(823);
  });

  it("lists the cards of a board: zones, piles, graveyard top and hand", () => {
    const cards = crumbleCards(view, { faceUpHand: false, width: 653 });
    // 1 monster, 1 spell, extra pile, deck pile, graveyard top, 2 hand cards.
    expect(cards).toHaveLength(7);
    expect(cards.filter((card) => card.back)).toHaveLength(5);
    expect(crumbleCards(view, { faceUpHand: true, width: 653 }).filter((card) => card.back)).toHaveLength(3);
  });

  it("is the same for the same seed and cut into six shards a card", () => {
    const cards = crumbleCards(view, { faceUpHand: false, width: 653 });
    const a = buildCrumble(cards, { rotateDeg: 180, scale: 0.6 }, 653, 7);
    const b = buildCrumble(cards, { rotateDeg: 180, scale: 0.6 }, 653, 7);
    expect(a).toEqual(b);
    expect(a.shards).toHaveLength(cards.length * 6);
    expect(a.dust).toHaveLength(26);
    expect(a.tiles.length).toBe(7 * 3 * 2);
    expect(buildCrumble(cards, { rotateDeg: 0, scale: 1 }, 653, 8)).not.toEqual(buildCrumble(cards, { rotateDeg: 0, scale: 1 }, 653, 7));
  });

  it("makes pieces fall down the screen whatever the turn of the seat", () => {
    const cards = crumbleCards(view, { faceUpHand: false, width: 653 });
    // At 180 degrees the board is upside down: screen-down is board-up (negative y).
    const turned = buildCrumble(cards, { rotateDeg: 180, scale: 1 }, 653, 3);
    expect(turned.tiles.every((tile) => tile.fall.to.y < 0)).toBe(true);
    const upright = buildCrumble(cards, { rotateDeg: 0, scale: 1 }, 653, 3);
    expect(upright.tiles.every((tile) => tile.fall.to.y > 0)).toBe(true);
  });

  it("gives the seeded generator values in [0, 1)", () => {
    const rnd = mulberry(1);
    for (let i = 0; i < 100; i += 1) {
      const value = rnd();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
