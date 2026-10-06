import { describe, expect, it } from "vitest";
import { captionSize, placeCaption } from "../../src/components/duel/declared-attack";

const view = { width: 2000, height: 1000 };
const size = { width: 200, height: 30 };

describe("placeCaption", () => {
  it("sits on the middle of the arrow when nothing is there", () => {
    expect(placeCaption({ x: 100, y: 500 }, { x: 900, y: 500 }, size, [], view)).toEqual({ x: 500, y: 500 });
  });

  it("steps off the cards of facing seats on a short arrow", () => {
    // A 90 px arrow between two fields: the middle is over a zone, a spot beside it is free.
    const zones = [{ left: 440, top: 470, width: 120, height: 60 }];
    const spot = placeCaption({ x: 500, y: 450 }, { x: 500, y: 540 }, size, zones, view);
    expect(spot).not.toEqual({ x: 500, y: 495 });
    const box = { left: spot.x - 100, top: spot.y - 15, width: 200, height: 30 };
    const clear = box.left + box.width <= 440 || box.left >= 560 || box.top + box.height <= 470 || box.top >= 530;
    expect(clear).toBe(true);
  });

  it("keeps to the screen and falls back to the least covered spot", () => {
    const wall = [{ left: 0, top: 0, width: 2000, height: 1000 }];
    const spot = placeCaption({ x: 100, y: 500 }, { x: 900, y: 500 }, size, wall, view);
    expect(spot).toEqual({ x: 500, y: 500 });
    const edge = placeCaption({ x: 20, y: 500 }, { x: 40, y: 500 }, size, [], view);
    expect(edge.x - 100).toBeGreaterThanOrEqual(0);
  });

  it("sizes a caption from its text, capped at 360 px", () => {
    expect(captionSize("Ann attacks Di").width).toBeLessThan(captionSize("Ann: direct attack on Di").width);
    expect(captionSize("x".repeat(200)).width).toBe(360);
  });
});
