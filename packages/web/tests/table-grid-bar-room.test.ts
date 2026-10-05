import { describe, expect, it } from "vitest";
import { barRoomOf } from "../src/components/duel/table/grid-stage";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const room = (value: string | undefined) => value?.split(",").map(Number);

// The pick bar of the 4-way grid takes a free gap of the top lane (y 8 to 88). It never covers a plate, a field, a far
// hand or the view control that reaches into that lane.
describe("barRoomOf", () => {
  it("keeps the bar off a far hand fan between two plates (the 1920x1080 grid)", () => {
    const blocks = [
      rect(8, 12, 254, 88), // top-left plate
      rect(292, 13, 211, 96), // its hand fan
      rect(829, 56, 230, 80), // top-right plate
      rect(1131, 58, 129, 90), // its hand fan
      rect(1430, 10, 102, 28), // All fields
      rect(8, 105, 777, 453), // a field below the lane
    ];
    const [x, y, width, height] = room(barRoomOf(1542, blocks))!;
    expect(y).toBe(8);
    expect(height).toBe(80);
    expect(x).toBeGreaterThanOrEqual(503 + 8);
    expect(x + width).toBeLessThanOrEqual(829 - 8);
  });

  it("prefers the full-width gap nearest the middle and centres the bar in it as far as it can", () => {
    const [x, , width] = room(barRoomOf(1000, [rect(300, 20, 100, 40)]))!;
    expect(width).toBe(440);
    expect(x).toBe(408); // 8px clear of the box at 400; the middle (500) is out of reach
    expect(x + width).toBeLessThanOrEqual(1000 - 8 - 8);
  });

  it("ignores boxes below the lane, so the bar can sit over the gap above a board", () => {
    expect(room(barRoomOf(900, [rect(100, 102, 700, 400)]))).toEqual([230, 8, 440, 80]);
  });

  it("gives no room when no gap holds a bar of 240px", () => {
    expect(barRoomOf(600, [rect(100, 10, 200, 50), rect(400, 10, 150, 50)])).toBeUndefined();
  });
});
