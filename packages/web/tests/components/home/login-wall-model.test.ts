import { describe, expect, it } from "vitest";
import {
  BAND_CARD_WIDTH,
  BAND_OPACITY,
  COLUMN_OPACITY,
  RING_CARD_IDS,
  WALL_CARD_IDS,
  WALL_GAP,
  cardImageSrc,
  choosePick,
  columnsForWidth,
  computeLayout,
  parallaxTarget,
  pickDelay,
  pickTarget,
  railCardCount,
  railDeck,
  railDuration,
  rampRate,
  showBottomBand,
  wallCardWidth,
} from "../../../app/(auth)/login/login-wall-model";

describe("columnsForWidth", () => {
  it.each([
    [360, 0],
    [899, 0],
    [900, 1],
    [1199, 1],
    [1200, 2],
    [1759, 2],
    [1760, 3],
    [2560, 3],
  ])("gives %ipx wide %i columns", (width, columns) => {
    expect(columnsForWidth(width)).toBe(columns);
  });
});

describe("wallCardWidth", () => {
  it("stays smaller than the 212px ring cards at every width", () => {
    for (const width of [900, 1024, 1199, 1200, 1440, 1759, 1760, 1920, 3000]) {
      const columns = columnsForWidth(width) as 1 | 2 | 3;
      expect(wallCardWidth(columns, width)).toBeLessThan(212);
    }
  });
  it("caps at 126, 156 and 168px", () => {
    expect(wallCardWidth(1, 1199)).toBeLessThanOrEqual(126);
    expect(wallCardWidth(2, 1759)).toBeLessThanOrEqual(156);
    expect(wallCardWidth(3, 3000)).toBe(168);
  });
  it("fits the side room: columns plus gaps and padding stay inside it", () => {
    for (const width of [900, 1024, 1199, 1200, 1440, 1759, 1760, 1920]) {
      const columns = columnsForWidth(width) as 1 | 2 | 3;
      const room = (width - 608) / 2;
      expect(wallCardWidth(columns, width) * columns).toBeLessThanOrEqual(room);
    }
  });
});

describe("rail card counts", () => {
  const pitch = 245 + WALL_GAP;
  it("is never fewer than 8", () => {
    expect(railCardCount(100, pitch)).toBe(8);
  });
  it("grows with the height, with two cards of slack", () => {
    expect(railCardCount(1500, 200)).toBe(Math.ceil((1500 + 400) / 200));
    expect(railCardCount(2400, 200)).toBeGreaterThan(railCardCount(1200, 200));
  });
  it("covers the whole height", () => {
    for (const length of [640, 900, 1080, 1440, 2160]) {
      expect(railCardCount(length, pitch) * pitch).toBeGreaterThanOrEqual(length);
    }
  });
});

describe("computeLayout", () => {
  it("builds walls with the column count at 1440 by 900", () => {
    const layout = computeLayout({ width: 1440, height: 900 }, 945, false);
    expect(layout).toMatchObject({ mode: "walls", cols: 2 });
    expect(layout.n).toBeGreaterThanOrEqual(8);
  });
  it("builds bands below 900", () => {
    expect(computeLayout({ width: 390, height: 844 }, 0, false)).toMatchObject({ mode: "bands", cols: 1, bottomBand: true });
  });
  it("drops the bottom band on a phone shorter than 800px, and when an error message shows", () => {
    expect(showBottomBand(740, false)).toBe(false);
    expect(showBottomBand(799, false)).toBe(false);
    expect(showBottomBand(800, false)).toBe(true);
    expect(showBottomBand(844, true)).toBe(false);
    expect(computeLayout({ width: 360, height: 740 }, 0, false).bottomBand).toBe(false);
    expect(computeLayout({ width: 390, height: 844 }, 0, true).bottomBand).toBe(false);
  });
  it("sizes band rails across the width", () => {
    const layout = computeLayout({ width: 899, height: 844 }, 0, false);
    expect(layout.n * (BAND_CARD_WIDTH + WALL_GAP)).toBeGreaterThanOrEqual(899);
  });
});

describe("the deck", () => {
  it("has 27 distinct cards and none of the three ring cards", () => {
    expect(WALL_CARD_IDS).toHaveLength(27);
    expect(new Set(WALL_CARD_IDS).size).toBe(27);
    for (const id of RING_CARD_IDS) expect(WALL_CARD_IDS).not.toContain(id);
  });
  it("never puts a ring card in a rail", () => {
    for (const wall of [0, 1]) {
      for (const column of [0, 1, 2]) {
        const deck = railDeck(wall * 11 + column * 5 + 2, 30);
        for (const id of RING_CARD_IDS) expect(deck).not.toContain(id);
      }
    }
  });
  it("shows every card before repeating one", () => {
    const deck = railDeck(2, 27);
    expect(new Set(deck).size).toBe(27);
  });
  it("starts neighbouring columns on different cards", () => {
    expect(railDeck(2, 8)[0]).not.toBe(railDeck(7, 8)[0]);
  });
  it("reads card art from YGOPRODeck's small images, which need no sign-in", () => {
    expect(cardImageSrc(5405694)).toBe(
      `/_next/image?url=${encodeURIComponent("https://images.ygoprodeck.com/images/cards_small/5405694.jpg")}&w=256&q=75`,
    );
  });
});

describe("the pick", () => {
  const viewport = { width: 1440, height: 900 };
  it("only picks a card near the middle of the height on walls", () => {
    const cards = [
      { id: WALL_CARD_IDS[0], centre: 100 },
      { id: WALL_CARD_IDS[1], centre: 450 },
      { id: WALL_CARD_IDS[2], centre: 800 },
    ];
    expect(choosePick(cards, "walls", viewport, 0)?.id).toBe(WALL_CARD_IDS[1]);
    expect(choosePick(cards, "walls", viewport, 0.99)?.id).toBe(WALL_CARD_IDS[1]);
  });
  it("only picks near the middle of the width on bands", () => {
    const cards = [{ id: WALL_CARD_IDS[0], centre: 20 }, { id: WALL_CARD_IDS[1], centre: 200 }];
    expect(choosePick(cards, "bands", { width: 390, height: 844 }, 0.5)?.id).toBe(WALL_CARD_IDS[1]);
  });
  it("never chooses a ring card, even if one were in the pool", () => {
    const cards = RING_CARD_IDS.map((id) => ({ id, centre: 450 }));
    expect(choosePick(cards, "walls", viewport, 0.3)).toBeNull();
    const mixed = [...cards, { id: WALL_CARD_IDS[5], centre: 460 }];
    for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(choosePick(mixed, "walls", viewport, random)?.id).toBe(WALL_CARD_IDS[5]);
    }
  });
  it("picks nothing when no card is in range", () => {
    expect(choosePick([{ id: WALL_CARD_IDS[0], centre: 10 }], "walls", viewport, 0.5)).toBeNull();
  });
  it("alternates sides", () => {
    expect([0, 1, 2, 3].map((i) => pickTarget(2, i))).toEqual([0, 1, 0, 1]);
    expect(pickTarget(1, 5)).toBe(0);
    expect(pickTarget(0, 0)).toBe(-1);
  });
  it("first pick comes at 3.4s from load, then every 4 to 6s on walls and 6s on a phone", () => {
    expect(pickDelay("walls", true, 0, 0.5)).toBe(3400);
    expect(pickDelay("walls", true, 3300, 0.5)).toBe(1500);
    expect(pickDelay("walls", false, 0, 0)).toBe(4000);
    expect(pickDelay("walls", false, 0, 1)).toBe(6000);
    expect(pickDelay("bands", false, 0, 0.7)).toBe(6000);
  });
});

describe("motion numbers", () => {
  it("dims the walls about 15% from the first mock", () => {
    expect(COLUMN_OPACITY).toEqual([0.42, 0.31, 0.22]);
    expect(BAND_OPACITY).toBe(0.42);
  });
  it("runs one card every 6.4, 7.4 and 8.0s on the walls and 3.6s on a band", () => {
    expect(railDuration("walls", 0, 10)).toBe(64000);
    expect(railDuration("walls", 1, 10)).toBe(74000);
    expect(railDuration("walls", 2, 10)).toBe(80000);
    expect(railDuration("bands", 0, 10)).toBe(36000);
  });
  it("eases the drift up from 0 to 1", () => {
    expect(rampRate(0)).toBe(0);
    expect(rampRate(1)).toBe(1);
    expect(rampRate(0.5)).toBeGreaterThan(0.5);
  });
  it("leans against the pointer by up to 10px across and 6px up and down", () => {
    expect(parallaxTarget(0, 0, 1000, 800)).toEqual({ x: 10, y: 6 });
    expect(parallaxTarget(1000, 800, 1000, 800)).toEqual({ x: -10, y: -6 });
    const mid = parallaxTarget(500, 400, 1000, 800);
    expect(Math.abs(mid.x)).toBe(0);
    expect(Math.abs(mid.y)).toBe(0);
  });
});
