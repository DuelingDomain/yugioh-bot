import { describe, expect, it } from "vitest";
import { routeAround } from "@/components/duel/table/pair-link";

describe("routeAround", () => {
  it("keeps a straight line when the ring is not in the way", () => {
    const { c } = routeAround({ x: 100, y: 500 }, { x: 500, y: 500 }, { x: 900, y: 100, r: 70 });
    expect(c).toEqual({ x: 300, y: 500 });
  });

  it("bows away from a ring that sits on the straight line", () => {
    const ring = { x: 300, y: 500, r: 70 };
    const { c } = routeAround({ x: 100, y: 500 }, { x: 500, y: 500 }, ring);
    expect(Math.abs(c.y - ring.y)).toBeGreaterThan(ring.r);
  });
});
