import { describe, expect, it } from "vitest";
import { exitPose } from "@/components/duel/table/grid-stage";
import { CRUMBLE_UNIT } from "@/components/duel/table/rival-field";
import type { GridCellRect } from "@/components/duel/table/grid-layout";

// A crumble that is narrower than its field shrinks the board before it shatters (owner, 2026-10-11).
describe("the exit pose of a grid seat", () => {
  it("gives the crumble the width of the field box, in board px at scale 1", () => {
    const z = 102.2;
    const spot = { z, rect: { x: 1141, y: 441, width: 757, height: 347 } } as unknown as GridCellRect;
    const pose = exitPose(3, spot, 0);
    expect(pose.width! * (z / CRUMBLE_UNIT)).toBeCloseTo(757, 5);
    expect(pose.x).toBe(1141 + 757 / 2);
  });
});
