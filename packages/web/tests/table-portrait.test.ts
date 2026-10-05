import { describe, expect, it } from "vitest";
import { boardBounds, portraitTable, seatObstacles, stageRectsOverlap, tableLayout } from "@/components/duel/table/geometry";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";

describe("phone table reflow", () => {
  for (const set of [FFA3_FIXTURES, FFA4_FIXTURES]) {
    it(`fills the available height without clipping ${set.format} boards, hands or plates`, () => {
      const engine = set.states.main.room.engine!;
      const layout = tableLayout(set.format, engine, 0);
      const portrait = portraitTable(layout, { mode: "home" }, 390)!;
      expect(portrait).not.toBeNull();
      const k = Math.min(378 / portrait.width, 470 / portrait.height);
      expect(portrait.height * k).toBeGreaterThan(440);
      const all = [...portrait.poses.values()];
      for (const pose of all) {
        const board = boardBounds(pose);
        expect(board.l).toBeGreaterThanOrEqual(550 - portrait.width / 2);
        expect(board.r).toBeLessThanOrEqual(550 + portrait.width / 2);
        expect(board.t).toBeGreaterThanOrEqual(0);
        expect(board.b).toBeLessThanOrEqual(portrait.height);
        const hand = seatObstacles(pose, pose.slot === "home")[1];
        expect(hand.y + hand.height / 2).toBeLessThanOrEqual(portrait.height);
        for (const other of all) {
          if (pose === other) continue;
          expect(stageRectsOverlap({ ...pose, width: 653 * pose.scale, height: 380 * pose.scale }, { ...other, width: 653 * other.scale, height: 380 * other.scale })).toBe(false);
        }
      }
      for (const anchor of portrait.anchors.values()) {
        const rect = { x: anchor.x + (anchor.me ? 106 : 98), y: anchor.y + (anchor.me ? 171 : 122) / 2, width: anchor.me ? 212 : 196, height: anchor.me ? 171 : 122, rotateDeg: 0 };
        expect(rect.x + rect.width / 2).toBeLessThanOrEqual(930);
        for (const pose of all) for (const obstacle of seatObstacles(pose, pose.slot === "home")) expect(stageRectsOverlap(rect, obstacle), `plate on seat ${pose.seat}`).toBe(false);
      }
    });
  }

  it("leaves desktop and other camera modes on their existing geometry", () => {
    const layout = tableLayout("ffa4", FFA4_FIXTURES.states.main.room.engine!, 0);
    expect(portraitTable(layout, { mode: "home" }, 1440)).toBeNull();
    expect(portraitTable(layout, { mode: "focus", focusSeat: 1 }, 390)).toBeNull();
    expect(portraitTable({ ...layout, format: "tag" }, { mode: "home" }, 390)).toBeNull();
  });
});
