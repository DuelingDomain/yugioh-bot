import { describe, expect, it } from "vitest";
import { cardTurn } from "@/components/duel/move-fx";
import { cardGeometry } from "@/components/duel/fx3d/effects/shards";

describe("the far player's cards face the other way", () => {
  it("adds half a circle for the opponent and a quarter for Defense Position", () => {
    expect(cardTurn("you", false)).toBe(0);
    expect(cardTurn("you", true)).toBe(90);
    expect(cardTurn("opp", false)).toBe(180);
    expect(cardTurn("opp", true)).toBe(270);
  });

  it("turns the 3D shard card half a circle for a far card", () => {
    const rect = { x: 0, y: 0, w: 60, h: 88 };
    expect(cardGeometry(rect, false).base).toBe(0);
    expect(cardGeometry(rect, false, true).base).toBeCloseTo(Math.PI);
    const sideways = { x: 0, y: 0, w: 88, h: 60 };
    expect(cardGeometry(sideways, true).base).toBeCloseTo(Math.PI / 2);
    expect(cardGeometry(sideways, true, true).base).toBeCloseTo((Math.PI * 3) / 2);
    expect(cardGeometry(sideways, true, true)).toMatchObject({ w: 60, h: 88 });
  });
});
