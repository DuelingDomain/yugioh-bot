// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { centerOfQuad, elementQuad, fitQuad, growQuad, isTurned, linearOf, quadBox, quadEdgePoint, rectQuad, roundedQuadPath, type Quad } from "../../src/components/duel/quad";

const turn = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)] as const;
};
/** The corners of a w x h card turned by `deg` about (cx, cy). */
function turned(cx: number, cy: number, w: number, h: number, deg: number): Quad {
  const [a, b, c, d] = turn(deg);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as const).map(([x, y]) => ({ x: cx + a * x + c * y, y: cy + b * x + d * y })) as Quad;
}

describe("fitQuad", () => {
  it.each([0, 30, 90, 120, 240, -45])("rebuilds the corners of a card turned %i degrees from its bounding rect", (deg) => {
    const expected = turned(300, 200, 60, 88, deg);
    const rect = quadBox(expected);
    const got = fitQuad(rect, 60, 88, turn(deg));
    got.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 3);
      expect(p.y).toBeCloseTo(expected[i].y, 3);
    });
    expect(isTurned(got)).toBe(deg % 180 !== 0);
  });

  it("keeps a straight box straight, and fits a scaled card to its rect", () => {
    const rect = { left: 10, top: 20, width: 30, height: 44 };
    expect(fitQuad(rect, 60, 88, [0.5, 0, 0, 0.5])).toEqual(rectQuad(rect));
    expect(fitQuad(rect, 60, 88, [0, 0, 0, 0])).toEqual(rectQuad(rect));
  });
});

describe("quad helpers", () => {
  it("grows a turned rectangle by the same pad on every edge", () => {
    const quad = turned(100, 100, 60, 88, 30);
    const grown = growQuad(quad, 5);
    const bigger = turned(100, 100, 70, 98, 30);
    grown.forEach((p, i) => {
      expect(p.x).toBeCloseTo(bigger[i].x, 3);
      expect(p.y).toBeCloseTo(bigger[i].y, 3);
    });
  });

  it("leaves a turned card at its real edge, not at its bounding box", () => {
    const quad = turned(100, 100, 60, 88, 45);
    const edge = quadEdgePoint(quad, { x: 500, y: 100 }, 0);
    // Toward +x the 45 degree card ends on its long edge, 30 * sqrt(2) from the centre; its bounding box would say 52.3.
    expect(edge.x - 100).toBeCloseTo(30 * Math.SQRT2, 3);
    expect(edge.y).toBeCloseTo(100, 3);
    expect(centerOfQuad(quad)).toEqual({ x: expect.closeTo(100, 6), y: expect.closeTo(100, 6) });
    const straight = quadEdgePoint(rectQuad({ left: 0, top: 0, width: 60, height: 88 }), { x: 500, y: 44 }, 4);
    expect(straight.x).toBeCloseTo(64, 3);
  });

  it("draws one rounded path with four corners", () => {
    const path = roundedQuadPath(turned(100, 100, 60, 88, 30), 9);
    expect(path.match(/Q/g)).toHaveLength(4);
    expect(path.endsWith("Z")).toBe(true);
  });
});

describe("elementQuad", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sums the turn of the element and of its ancestors", () => {
    const seat = document.createElement("div");
    const card = document.createElement("div");
    seat.appendChild(card);
    document.body.appendChild(seat);
    Object.defineProperty(card, "offsetWidth", { value: 60 });
    Object.defineProperty(card, "offsetHeight", { value: 88 });
    const expected = turned(300, 200, 60, 88, 120);
    const bounds = quadBox(expected);
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(bounds as DOMRect);
    vi.spyOn(window, "getComputedStyle").mockImplementation(((el: Element) => ({
      getPropertyValue: (name: string) => (el === seat && name === "rotate" ? "100deg" : el === card && name === "transform" ? "matrix(0.9396926, 0.3420201, -0.3420201, 0.9396926, 0, 0)" : ""),
    })) as never);
    // 100 deg on the seat, 20 deg on the card: 120 in all.
    const lin = linearOf(card);
    expect(lin[0]).toBeCloseTo(Math.cos((120 * Math.PI) / 180), 4);
    elementQuad(card).forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 2);
      expect(p.y).toBeCloseTo(expected[i].y, 2);
    });
    seat.remove();
  });

  it("falls back to the bounding rect when the element has no layout size", () => {
    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left: 1, top: 2, width: 3, height: 4 } as DOMRect);
    expect(elementQuad(el)).toEqual(rectQuad({ left: 1, top: 2, width: 3, height: 4 }));
  });
});
