import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clampRoom, handReach, planPickBarRoom } from "../src/components/duel/table/pick-bar-room";
import { clampBarShift, sameShift } from "../src/components/duel/bar-clamp";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const room = (value: string | undefined) => value?.split(",").map(Number) as [number, number, number, number];
const hits = (box: number[], other: ReturnType<typeof rect>) =>
  box[0] < other.x + other.width && other.x < box[0] + box[2] && box[1] < other.y + other.height && other.y < box[1] + box[3];
const insideBox = (box: number[], size: { width: number; height: number }) =>
  box[0] >= 0 && box[1] >= 0 && box[0] + box[2] <= size.width && box[1] + box[3] <= size.height;
const mid = (box: number[]) => ({ x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 });

const BOX = { width: 1892, height: 995 }; // the board box at 1920x1080
const HAND = rect(790, 810, 340, 90); // your live hand, at the bottom
const MONSTERS = [rect(670, 545, 80, 118), rect(795, 545, 80, 118), rect(795, 420, 80, 118)];

describe("planPickBarRoom: the card-pick bar stays in view", () => {
  it("sits near the middle of the box when the middle is clear", () => {
    const found = room(planPickBarRoom({ box: BOX, targets: [], hand: HAND }));
    expect(found).toBeDefined();
    const centre = mid(found);
    expect(Math.abs(centre.x - BOX.width / 2)).toBeLessThan(12);
    expect(Math.abs(centre.y - BOX.height / 2)).toBeLessThan(12);
  });

  it("picks the clear room nearest the middle, not the bottom edge", () => {
    // The middle is held by the monsters and the targets; the room beside them is nearer than the bottom dock.
    const blocks = [rect(700, 380, 500, 240)];
    const found = room(planPickBarRoom({ box: BOX, targets: blocks, hand: HAND }));
    expect(hits(found, blocks[0])).toBe(false);
    expect(found[1] + found[3]).toBeLessThan(BOX.height - 120);
    const centre = mid(found);
    expect(Math.hypot(centre.x - BOX.width / 2, centre.y - BOX.height / 2)).toBeLessThan(330);
  });

  it("is always fully inside the box, at every size", () => {
    for (const size of [{ width: 1892, height: 995 }, { width: 1352, height: 683 }, { width: 1252, height: 635 }, { width: 700, height: 500 }, { width: 360, height: 640 }]) {
      const found = room(planPickBarRoom({ box: size, targets: [rect(size.width / 2 - 60, size.height / 2 - 60, 120, 120)], hand: rect(size.width / 2 - 150, size.height - 100, 300, 80) }));
      expect(insideBox(found, size)).toBe(true);
    }
  });

  it("is inside the box even when targets and the hand fill it", () => {
    const size = { width: 800, height: 400 };
    const found = room(planPickBarRoom({ box: size, targets: [rect(0, 0, 800, 300)], hand: rect(100, 310, 600, 80) }));
    expect(insideBox(found, size)).toBe(true);
  });

  it("never covers a legal target", () => {
    const targets = [rect(100, 100, 300, 200), rect(900, 400, 120, 180), rect(1400, 700, 200, 160)];
    const found = room(planPickBarRoom({ box: BOX, targets, hand: HAND, cards: MONSTERS }));
    for (const target of targets) expect(hits(found, target)).toBe(false);
  });

  it("never covers the live hand, nor the band a raised card takes above it", () => {
    const found = room(planPickBarRoom({ box: BOX, targets: [], hand: HAND }));
    expect(hits(found, handReach(HAND))).toBe(false);
    // The hand is measured, not assumed: a taller hand (the bigger-hand layout) moves the room off it too.
    const tall = rect(700, 700, 500, 220);
    const above = room(planPickBarRoom({ box: BOX, targets: [rect(0, 0, 1892, 330)], hand: tall }));
    expect(hits(above, handReach(tall))).toBe(false);
    expect(hits(above, tall)).toBe(false);
  });

  it("keeps off the cards on the board and the HUD while a clear place exists", () => {
    const hud = [rect(850, 300, 200, 100)];
    const found = room(planPickBarRoom({ box: BOX, targets: [], hand: HAND, cards: MONSTERS, hud }));
    for (const block of [...MONSTERS, ...hud]) expect(hits(found, block)).toBe(false);
  });

  it("covers an empty zone before it covers a card, and a card before a target or the hand", () => {
    // Cards everywhere except the bottom strip, which is the hand: the cards give way, the target and the hand never.
    const size = { width: 800, height: 400 };
    const cards = [rect(0, 0, 800, 330)];
    const target = rect(360, 150, 80, 100);
    const hand = rect(250, 330, 300, 60);
    const found = room(planPickBarRoom({ box: size, targets: [target], hand, cards }));
    expect(hits(found, target)).toBe(false);
    expect(hits(found, handReach(hand))).toBe(false);
    expect(insideBox(found, size)).toBe(true);
  });

  it("tries a narrower, stacked bar where the full width does not fit", () => {
    const size = { width: 520, height: 700 };
    // A column of targets in the middle: only a narrow bar fits beside it.
    const targets = [rect(240, 12, 60, 676)];
    const found = room(planPickBarRoom({ box: size, targets }));
    expect(found[2]).toBeLessThan(420);
    expect(hits(found, targets[0])).toBe(false);
  });

  it("returns nothing for an unmeasured box", () => {
    expect(planPickBarRoom({ box: { width: 0, height: 0 }, targets: [] })).toBeUndefined();
  });

  it("does not read or move the camera: the same inputs give the same room", () => {
    const input = { box: BOX, targets: [rect(900, 400, 120, 180)], hand: HAND, cards: MONSTERS };
    expect(planPickBarRoom(input)).toBe(planPickBarRoom({ ...input }));
  });
});

describe("clampRoom", () => {
  it("moves a room that stands on the bottom edge back inside the box", () => {
    const moved = clampRoom(rect(100, 960, 420, 92), BOX);
    expect(moved.y + moved.height).toBeLessThanOrEqual(BOX.height - 12);
  });
  it("keeps a room that is inside", () => {
    expect(clampRoom(rect(100, 100, 420, 92), BOX)).toEqual(rect(100, 100, 420, 92));
  });
});

describe("clampBarShift: the bar as drawn is inside the board", () => {
  const board = { left: 0, top: 0, right: 1000, bottom: 600 };
  it("does nothing for a bar inside", () => {
    expect(clampBarShift({ left: 300, right: 700, top: 200, bottom: 280 }, { dx: 0, dy: 0 }, board)).toEqual({ dx: 0, dy: 0 });
  });
  it("lifts a bar that is cut at the bottom edge", () => {
    const shift = clampBarShift({ left: 300, right: 700, top: 560, bottom: 650 }, { dx: 0, dy: 0 }, board);
    expect(shift).toEqual({ dx: 0, dy: -58 });
  });
  it("moves a bar that is cut at the right and the left", () => {
    expect(clampBarShift({ left: 800, right: 1100, top: 100, bottom: 180 }, { dx: 0, dy: 0 }, board).dx).toBe(-108);
    expect(clampBarShift({ left: -50, right: 250, top: 100, bottom: 180 }, { dx: 0, dy: 0 }, board).dx).toBe(58);
  });
  it("gives the same answer when it runs again on the moved bar", () => {
    const first = clampBarShift({ left: 300, right: 700, top: 560, bottom: 650 }, { dx: 0, dy: 0 }, board);
    const again = clampBarShift({ left: 300, right: 700, top: 560 + first.dy, bottom: 650 + first.dy }, first, board);
    expect(sameShift(first, again)).toBe(true);
  });
  it("starts a bar that is taller than the board at the top edge", () => {
    expect(clampBarShift({ left: 300, right: 700, top: -40, bottom: 700 }, { dx: 0, dy: 0 }, board).dy).toBe(48);
  });
});

// The bar is in a slot over the whole box (z-index 50); your hand, a raised card included, is drawn inside the world canvas
// (a lower layer): a card raised from the hand never draws over the bar.
describe("the bar is drawn over your hand", () => {
  const css = (file: string) => readFileSync(join(__dirname, "../src/components/duel", file), "utf8");
  const zOf = (source: string, selector: string) => {
    const at = source.indexOf(`\n${selector} {`);
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf("}", at));
    return Number(/z-index:\s*(\d+)/.exec(body)?.[1]);
  };
  it("puts the prompt slot above the world canvas that holds the hand", () => {
    const stage = css("table/table-stage.module.css");
    expect(zOf(stage, ".slot")).toBeGreaterThan(zOf(stage, ".persp"));
  });
  it("puts the slot above the raised hand card, whose z-index is local to the field", () => {
    const stage = css("table/table-stage.module.css");
    const field = css("field.module.css");
    const raised = Number(/\.handCard:hover,\s*\.handCard:has\(:focus-visible\) \{\s*z-index:\s*(\d+)/.exec(field)?.[1]);
    expect(raised).toBeGreaterThan(0);
    expect(zOf(stage, ".slot")).toBeGreaterThan(raised);
  });
});
