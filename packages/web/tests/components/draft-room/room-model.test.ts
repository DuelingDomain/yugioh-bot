import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  anchorPoint,
  countKinds,
  dealReducer,
  INITIAL_DEAL,
  filterWords,
  isFiltering,
  joinNames,
  kindOf,
  levelsModel,
  matchesFilter,
  orderSeats,
  passDirection,
  passLabel,
  roomSizes,
  seatPackSize,
  stripEdges,
  tableCards,
  themeProgress,
  toggled,
  type RoomCard,
} from "../../../src/components/draft/room/room-model";

const card = (id: number, over: Partial<RoomCard> = {}): RoomCard => ({
  id,
  name: `Card ${id}`,
  type: "Effect Monster",
  frameType: "effect",
  attribute: "DARK",
  level: 4,
  effectText: "",
  imageUrl: "",
  imageUrlSmall: "",
  ...over,
});

describe("kinds", () => {
  it("sorts cards into monster, spell, trap and extra", () => {
    expect(kindOf(card(1))).toBe("monster");
    expect(kindOf(card(2, { type: "Normal Spell Card", frameType: "spell" }))).toBe("spell");
    expect(kindOf(card(3, { type: "Normal Trap Card", frameType: "trap" }))).toBe("trap");
    expect(kindOf(card(4, { type: "Synchro Monster", frameType: "synchro" }))).toBe("extra");
    const c = countKinds([card(1), card(2, { frameType: "spell", type: "Spell Card" })]);
    expect(c.monster).toBe(1);
    expect(c.spell).toBe(1);
  });
});

describe("pass direction", () => {
  it("alternates by round and can be turned off", () => {
    expect(passDirection(1, true)).toBe(1);
    expect(passDirection(2, true)).toBe(-1);
    expect(passDirection(2, false)).toBe(1);
    expect(passDirection(2, undefined)).toBe(-1);
    expect(passLabel(1)).toBe("Passing left");
    expect(passLabel(-1)).toBe("Passing right");
  });
  it("counts what is left in a seat's pack", () => {
    expect(seatPackSize({ packSize: 8, pickStep: 1, hasPicked: false })).toBe(8);
    expect(seatPackSize({ packSize: 8, pickStep: 3, hasPicked: true })).toBe(5);
  });
});

describe("filter", () => {
  it("matches by kind, text, level and attribute", () => {
    const m = card(1, { name: "Dark Magician", level: 7 });
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(matchesFilter(m, EMPTY_FILTER)).toBe(true);
    expect(matchesFilter(m, { ...EMPTY_FILTER, q: "magician" })).toBe(true);
    expect(matchesFilter(m, { ...EMPTY_FILTER, q: "dragon" })).toBe(false);
    expect(matchesFilter(m, { ...EMPTY_FILTER, kinds: new Set(["spell" as const]) })).toBe(false);
    expect(matchesFilter(m, { ...EMPTY_FILTER, attr: new Set(["DARK"]) })).toBe(true);
    expect(isFiltering({ ...EMPTY_FILTER, q: "x" })).toBe(true);
    expect(filterWords({ ...EMPTY_FILTER, q: "x" })).toContain("x");
  });
  it("toggles set members without mutating", () => {
    const a = new Set(["a"]);
    const b = toggled(a, "b");
    expect([...a]).toEqual(["a"]);
    expect([...b].sort()).toEqual(["a", "b"]);
    expect([...toggled(b, "a")]).toEqual(["b"]);
  });
  it("joins names", () => {
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
  });
});

describe("levels", () => {
  it("builds a model for monsters", () => {
    const m = levelsModel([card(1, { level: 3 }), card(2, { level: 8 })]);
    expect(m).toBeTruthy();
  });
});

describe("sizes and theme progress", () => {
  it("defaults and derives phases", () => {
    const s = roomSizes({ mode: "theme", cardsPerPlayer: 10, extraDeckSize: 3 });
    expect(s.theme).toBe(true);
    expect(s.total).toBe(13);
    expect(themeProgress(4, s).inExtra).toBe(false);
    expect(themeProgress(10, s).inExtra).toBe(true);
    expect(roomSizes({}).total).toBe(40);
  });
});

describe("seats", () => {
  it("puts you first and rotates the rest by seat order", () => {
    const out = orderSeats([
      { seatIndex: 0, playerId: 1, displayName: "A", hasPicked: false, isCurrentPlayer: false },
      { seatIndex: 1, playerId: 2, displayName: "B", hasPicked: false, isCurrentPlayer: true },
      { seatIndex: 2, playerId: 3, displayName: "C", hasPicked: false, isCurrentPlayer: false },
    ]);
    expect(out[0].isMe).toBe(true);
    expect(out.map((s) => s.seat?.displayName)).toEqual(["B", "C", "A"]);
  });
});

describe("stripEdges", () => {
  it("omits the attribute when all seats fit", () => {
    expect(stripEdges(0, 300, 330)).toBeUndefined();
    expect(stripEdges(0, 330, 330)).toBeUndefined();
  });

  it("shows more seats at the end when scrolled to the start", () => {
    expect(stripEdges(0, 550, 330)).toBe("end");
  });

  it("shows more seats on both sides in the middle", () => {
    expect(stripEdges(110, 550, 330)).toBe("both");
  });

  it("shows more seats at the start when scrolled to the end", () => {
    expect(stripEdges(220, 550, 330)).toBe("start");
  });

  it("ignores up to one pixel at either edge", () => {
    expect(stripEdges(0, 331, 330)).toBeUndefined();
    expect(stripEdges(0, 331.1, 330)).toBe("end");
    expect(stripEdges(0.5, 550, 330)).toBe("end");
    expect(stripEdges(1, 550, 330)).toBe("end");
    expect(stripEdges(1.1, 550, 330)).toBe("both");
    expect(stripEdges(218.9, 550, 330)).toBe("both");
    expect(stripEdges(219, 550, 330)).toBe("start");
    expect(stripEdges(219.5, 550, 330)).toBe("start");
  });
});

describe("table anchors", () => {
  const tw = 580;
  const th = 400;

  it.each([2, 3, 4, 5, 7, 8, 9, 12, 13])("keeps your seat at the near middle with %i players", (n) => {
    expect(anchorPoint(0, n, tw, th)).toEqual({ x: 290, y: 430 });
  });

  it("keeps up to three friends on the far edge", () => {
    expect(anchorPoint(1, 2, tw, th)).toEqual({ x: 290, y: -14 });
    expect(anchorPoint(1, 3, tw, th).x).toBeCloseTo(17.4);
    expect(anchorPoint(2, 3, tw, th).x).toBeCloseTo(562.6);
    expect(anchorPoint(2, 4, tw, th)).toEqual({ x: 290, y: -14 });
  });

  it.each([
    { n: 5, xs: [69.6, 510.4] },
    { n: 6, xs: [69.6, 290, 510.4] },
    { n: 7, xs: [69.6, 216.5333333333, 363.4666666667, 510.4] },
  ])("spreads the far row wider with $n players and preserves the side seats", ({ n, xs }) => {
    expect(anchorPoint(1, n, tw, th).x).toBe(-46);
    expect(anchorPoint(1, n, tw, th).y).toBeCloseTo(224);
    expect(anchorPoint(n - 1, n, tw, th).x).toBe(626);
    expect(anchorPoint(n - 1, n, tw, th).y).toBeCloseTo(224);
    xs.forEach((x, j) => {
      expect(anchorPoint(j + 2, n, tw, th).x).toBeCloseTo(x);
      expect(anchorPoint(j + 2, n, tw, th).y).toBe(-14);
    });
  });

  it.each([
    { n: 8, side: 1, far: 5 },
    { n: 9, side: 2, far: 4 },
    { n: 10, side: 2, far: 5 },
    { n: 11, side: 3, far: 4 },
    { n: 12, side: 3, far: 5 },
    { n: 13, side: 3, far: 6 },
    { n: 20, side: 3, far: 13 },
  ])("places $n players clockwise with $side / $far / $side friends", ({ n, side, far }) => {
    const anchors = Array.from({ length: n - 1 }, (_, j) => anchorPoint(j + 1, n, tw, th));
    const left = anchors.filter((p) => p.x === -46);
    const rim = anchors.filter((p) => p.y === -14);
    const right = anchors.filter((p) => p.x === 626);

    expect(left).toHaveLength(side);
    expect(rim).toHaveLength(far);
    expect(right).toHaveLength(side);
    expect(anchors).toEqual([...left, ...rim, ...right]);

    for (let j = 1; j < side; j++) {
      expect(left[j].y).toBeLessThan(left[j - 1].y);
      expect(right[j].y).toBeGreaterThan(right[j - 1].y);
    }
    for (let j = 1; j < far; j++) {
      expect(rim[j].x).toBeGreaterThan(rim[j - 1].x);
    }

    expect(left[0].y).toBeCloseTo(side === 1 ? 224 : 312);
    expect(left[side - 1].y).toBeCloseTo(side === 1 ? 224 : 120);
    expect(right[0].y).toBeCloseTo(side === 1 ? 224 : 120);
    expect(right[side - 1].y).toBeCloseTo(side === 1 ? 224 : 312);
    expect(rim[0].x).toBeCloseTo(58);
    expect(rim[far - 1].x).toBeCloseTo(522);
    if (side === 3) {
      expect(left[1].y).toBeCloseTo(216);
      expect(right[1].y).toBeCloseTo(216);
    }
  });

  it("leaves at least 96 pixels between neighbouring far seats at twelve players", () => {
    const rim = Array.from({ length: 11 }, (_, j) => anchorPoint(j + 1, 12, tw, th)).filter((p) => p.y === -14);
    expect(rim).toHaveLength(5);
    for (let j = 1; j < rim.length; j++) {
      expect(rim[j].x - rim[j - 1].x).toBeGreaterThanOrEqual(96);
    }
  });
});

describe("deal reducer", () => {
  const server = (stepKey: string, pack: RoomCard[], isMyTurn = true, poolIds: number[] = []) =>
    ({ type: "server", stepKey, pack, isMyTurn, poolIds: new Set(poolIds), completed: false, theme: false }) as const;

  it("deals a pack, then ignores a stale poll after your pick", () => {
    let s = dealReducer(INITIAL_DEAL, server("1:1", [card(1), card(2)]));
    expect(s.dealt.map((c) => c.id)).toEqual([1, 2]);
    expect(s.reason).toBe("deal");
    s = dealReducer(s, { type: "picked", cardId: 1 });
    expect(tableCards(s).map((c) => c.id)).toEqual([2]);
    // a poll that still carries the same cards, minus the pick, changes nothing
    expect(dealReducer(s, server("1:1", [card(2)]))).toBe(s);
  });

  it("rolls the pick back when the server still offers the card", () => {
    let s = dealReducer(INITIAL_DEAL, server("1:1", [card(1), card(2)]));
    s = dealReducer(s, { type: "picked", cardId: 1 });
    s = dealReducer(s, server("1:1", [card(1), card(2)]));
    expect(s.pickedId).toBeNull();
  });

  it("removes the taken card after a stale full-pack poll and a resolved step", () => {
    let s = dealReducer(INITIAL_DEAL, server("1:1", [card(1), card(2)]));
    s = dealReducer(s, { type: "picked", cardId: 1 });
    s = dealReducer(s, server("1:1", [card(1), card(2)]));
    expect(s.pickedId).toBeNull();

    s = dealReducer(s, server("1:1", [], false, [1]));
    expect(s.pickedId).toBe(1);
    expect(tableCards(s).map((c) => c.id)).toEqual([2]);
    expect(s.seq).toBe(1);
  });

  it("removes a card picked in another tab from the waiting table", () => {
    let s = dealReducer(INITIAL_DEAL, server("1:1", [card(1), card(2)]));
    s = dealReducer(s, server("1:1", [], false, [1]));
    expect(s.pickedId).toBe(1);
    expect(tableCards(s).map((c) => c.id)).toEqual([2]);
  });

  it("corrects the optimistic pick when the pool contains a different dealt card", () => {
    let s = dealReducer(INITIAL_DEAL, server("1:1", [card(1), card(2)]));
    s = dealReducer(s, { type: "picked", cardId: 2 });
    s = dealReducer(s, server("1:1", [], false, [1]));
    expect(s.pickedId).toBe(1);
    expect(tableCards(s).map((c) => c.id)).toEqual([2]);
  });

  it("keeps a pool-confirmed pick off the table even when the full pack is offered", () => {
    let s = dealReducer(INITIAL_DEAL, server("1:1", [card(1), card(2)]));
    s = dealReducer(s, { type: "picked", cardId: 1 });
    expect(dealReducer(s, server("1:1", [card(1), card(2)], true, [1]))).toBe(s);
  });

  it("keeps the local pick while waiting for a pool update", () => {
    let s = dealReducer(INITIAL_DEAL, server("1:1", [card(1), card(2)]));
    s = dealReducer(s, { type: "picked", cardId: 1 });
    expect(dealReducer(s, server("1:1", [], false))).toBe(s);
  });

  it("passes a new pack on the next step", () => {
    let s = dealReducer(INITIAL_DEAL, server("1:1", [card(1)]));
    s = dealReducer(s, server("1:2", [card(5)]));
    expect(s.reason).toBe("pass");
    expect(s.seq).toBe(2);
    expect(s.dealt.map((c) => c.id)).toEqual([5]);
  });
});
