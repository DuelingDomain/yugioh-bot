import { describe, expect, it } from "vitest";
import { BAR_MAX_WIDTH, BAR_MIN_WIDTH, BAR_ROW_FIT, placeSelectBar, samePlace, type BarRect, type BarZone } from "@/components/duel/select-bar-place";

const board: BarRect = { left: 100, right: 1100, top: 50, bottom: 950 };
const topHand: BarRect = { left: 300, right: 900, top: 50, bottom: 130 };
const bottomHand: BarRect = { left: 300, right: 900, top: 870, bottom: 950 };

/** Two Extra Monster Zones in columns 2 and 4, with `gap` free pixels between them. */
function emzPair(gap: number, legal: { left?: boolean; right?: boolean } = {}): BarZone[] {
  const middle = 600;
  return [
    { left: middle - gap / 2 - 200, right: middle - gap / 2, top: 400, bottom: 600, legal: legal.left ?? false },
    { left: middle + gap / 2, right: middle + gap / 2 + 200, top: 400, bottom: 600, legal: legal.right ?? false },
  ];
}

describe("placeSelectBar", () => {
  it("centres on the Extra Monster Zone band and the gap between the zones", () => {
    const place = placeSelectBar({ board, emz: emzPair(700), hands: [topHand, bottomHand] });
    expect(place.mode).toBe("mid");
    expect(place.top).toBe(450); // band centre 500, board top 50
    expect(place.left).toBe(500); // gap centre 600, board left 100
  });

  it("keeps one row and a limit equal to the gap when the gap holds the bar", () => {
    const place = placeSelectBar({ board, emz: emzPair(700), hands: [] });
    expect(place.stack).toBe(false);
    expect(place.fit).toBe(BAR_MAX_WIDTH);
  });

  it("limits the bar to a gap that holds it and stacks the buttons under the text", () => {
    const place = placeSelectBar({ board, emz: emzPair(300), hands: [] });
    expect(place.mode).toBe("mid");
    expect(place.stack).toBe(true);
    expect(place.fit).toBe(300 - 16);
    expect(300 - 16).toBeGreaterThanOrEqual(BAR_MIN_WIDTH);
    expect(300 - 16).toBeLessThan(BAR_ROW_FIT);
  });

  it("uses a gap exactly as wide as the narrowest bar", () => {
    const place = placeSelectBar({ board, emz: emzPair(BAR_MIN_WIDTH + 16), hands: [] });
    expect(place).toMatchObject({ mode: "mid", fit: BAR_MIN_WIDTH, stack: true });
  });

  it("never squeezes the bar: a narrow gap with no legal Extra Monster Zone keeps the centre line at full width", () => {
    const place = placeSelectBar({ board, emz: emzPair(100), hands: [topHand] });
    expect(place.mode).toBe("mid");
    expect(place.top).toBe(450);
    expect(place.left).toBe(500);
    expect(place.fit).toBeNull();
    expect(place.stack).toBe(false);
  });

  it("treats a gap just under the narrowest bar as too narrow", () => {
    const place = placeSelectBar({ board, emz: emzPair(BAR_MIN_WIDTH + 15), hands: [] });
    expect(place.fit).toBeNull();
    const legal = placeSelectBar({ board, emz: emzPair(BAR_MIN_WIDTH + 15, { left: true }), hands: [topHand] });
    expect(legal.mode).toBe("top");
  });

  it("falls back under the opponent's hand when a legal Extra Monster Zone would be covered", () => {
    const place = placeSelectBar({ board, emz: emzPair(100, { right: true }), hands: [topHand, bottomHand] });
    expect(place.mode).toBe("top");
    expect(place.top).toBe(86); // hand bottom 130 - board top 50 + 6
    expect(place.left).toBeNull();
    expect(place.fit).toBeNull();
  });

  it("keeps the middle for a legal Extra Monster Zone when the gap leaves it clear", () => {
    const place = placeSelectBar({ board, emz: emzPair(300, { left: true, right: true }), hands: [] });
    expect(place.mode).toBe("mid");
  });

  it("uses the point halfway between the hands when the format has no Extra Monster Zones", () => {
    const place = placeSelectBar({ board, emz: [], hands: [topHand, bottomHand] });
    // (130 + 870) / 2 - 50 = 450
    expect(place).toMatchObject({ mode: "mid", top: 450, left: null, fit: null, stack: false });
  });

  it("falls back to the board centre when nothing can be measured", () => {
    expect(placeSelectBar({ board, emz: [], hands: [] }).top).toBe(450);
    const empty = placeSelectBar({ board: { left: 0, right: 0, top: 0, bottom: 0 }, emz: [], hands: [] });
    expect(empty).toMatchObject({ mode: "mid", top: null, left: null });
  });

  it("needs a hand on each side to find the middle, else uses the board centre", () => {
    const place = placeSelectBar({ board, emz: [], hands: [topHand] });
    expect(place.top).toBe(450);
  });
});

describe("placeSelectBar with the Rooftop's four shared cells", () => {
  /** Two cells each side of the middle: a 60 wide cell, 20 between the pair, `gap` free in the middle. */
  function band(gap: number, legalInner = false): BarZone[] {
    const cell = (left: number, legal = false): BarZone => ({ left, right: left + 60, top: 400, bottom: 460, legal });
    const centre = 600;
    return [cell(centre - gap / 2 - 140), cell(centre - gap / 2 - 60, legalInner), cell(centre + gap / 2), cell(centre + gap / 2 + 80)];
  }

  it("sits in the middle gap between the inner cells, not across the whole band", () => {
    const place = placeSelectBar({ board, emz: band(340), hands: [] });
    expect(place.mode).toBe("mid");
    expect(place.left).toBe(500);
    expect(place.fit).toBe(340 - 16);
  });

  it("goes to the top edge when the middle gap is too narrow and a cell can be picked", () => {
    const place = placeSelectBar({ board, emz: band(200, true), hands: [topHand, bottomHand] });
    expect(place.mode).toBe("top");
  });
});

describe("samePlace", () => {
  it("compares every field", () => {
    const a = placeSelectBar({ board, emz: emzPair(300), hands: [] });
    expect(samePlace(a, { ...a })).toBe(true);
    expect(samePlace(a, { ...a, stack: !a.stack })).toBe(false);
    expect(samePlace(a, { ...a, top: 1 })).toBe(false);
  });
});
