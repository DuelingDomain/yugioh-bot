import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planStripRoom, STRIP_ROOM, stripRoomSize } from "../src/components/duel/table/strip-room";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const hits = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (r: ReturnType<typeof rect>, box: { width: number; height: number }) => r.x >= 0 && r.y >= 0 && r.x + r.width <= box.width && r.y + r.height <= box.height;

/** The board box and the HUD of the FFA3 table as measured at each window size (own zoom, board px). */
const BOXES = {
  "1920x1080": { width: 1892, height: 995 },
  "2560x1440": { width: 2532, height: 1355 },
  "1366x768": { width: 1338, height: 683 },
  "1280x720": { width: 1252, height: 635 },
};
const hudAt = (box: { width: number; height: number }) => ({
  // the life plates, the phase ring and the Reset control at the top; the plate at the right
  key: [rect(box.width * 0.18, 60, 150, 90), rect(box.width * 0.6, 60, 150, 90), rect(box.width / 2 - 56, 40, 112, 112), rect(box.width - 170, 8, 152, 28), rect(box.width * 0.74, box.height * 0.6, 150, 95)],
  // the chain stack and the Deck Master plate at the left, the responses dock at the bottom right
  soft: [rect(0, 180, 148, 133), rect(0, box.height - 262, 219, 262), rect(box.width - 168, box.height - 132, 168, 132)],
  hand: rect(box.width / 2 - 170, box.height - 95, 340, 90),
});

describe("stripRoomSize: the cards are about twice as large", () => {
  it("wants 130 px tiles, twice the 65 px tiles of the pair box", () => {
    expect(STRIP_ROOM.card).toBeGreaterThanOrEqual(2 * 65);
    expect(stripRoomSize(2, BOXES["1920x1080"]).card).toBe(STRIP_ROOM.card);
    expect(stripRoomSize(10, BOXES["1366x768"]).card).toBe(STRIP_ROOM.card);
  });

  it("holds up to six tiles in a row, then wraps into rows that scroll", () => {
    expect(stripRoomSize(2, BOXES["1920x1080"]).cols).toBe(2);
    expect(stripRoomSize(5, BOXES["1920x1080"]).cols).toBe(5);
    const ten = stripRoomSize(10, BOXES["1920x1080"]);
    expect(ten.cols).toBe(6);
    expect(ten.height).toBeGreaterThan(stripRoomSize(2, BOXES["1920x1080"]).height);
    expect(stripRoomSize(14, BOXES["1920x1080"]).cols).toBe(6);
  });

  it("never asks for more than the box", () => {
    for (const box of Object.values(BOXES)) {
      for (const count of [1, 2, 5, 10, 14, 40]) {
        const size = stripRoomSize(count, box);
        expect(size.width).toBeLessThanOrEqual(box.width - 2 * STRIP_ROOM.edge);
        expect(size.height).toBeLessThanOrEqual(box.height - 2 * STRIP_ROOM.edge);
      }
    }
  });
});

describe("planStripRoom: the panel shows in full, off the HUD", () => {
  it("is always wholly inside the box, with 2, 5, 10 and 14 cards at every window size", () => {
    for (const box of Object.values(BOXES)) {
      const { key, soft, hand } = hudAt(box);
      for (const count of [2, 5, 10, 14]) {
        const found = planStripRoom({ box, count, hud: key, soft, hand });
        expect(found, `${box.width}x${box.height} ${count}`).toBeDefined();
        expect(inside(found!, box), `${box.width}x${box.height} ${count}`).toBe(true);
      }
    }
  });

  it("keeps the large tiles and clears the HUD and the hand where the box has room (1080p and 1440p)", () => {
    for (const name of ["1920x1080", "2560x1440"] as const) {
      const box = BOXES[name];
      const { key, soft, hand } = hudAt(box);
      for (const count of [2, 5, 10, 14]) {
        const found = planStripRoom({ box, count, hud: key, soft, hand })!;
        expect(found.card, `${name} ${count}`).toBe(STRIP_ROOM.card);
        for (const block of [...key, ...soft, hand]) expect(hits(found, block), `${name} ${count}`).toBe(false);
      }
    }
  });

  it("never covers the key HUD where a clear place exists, even on a small window", () => {
    for (const name of ["1366x768", "1280x720"] as const) {
      const box = BOXES[name];
      // Only the plates at the top: a clear place exists below them for every count.
      const key = [rect(box.width * 0.18, 20, 150, 90), rect(box.width * 0.6, 20, 150, 90), rect(box.width / 2 - 56, 10, 112, 100)];
      for (const count of [2, 10]) {
        const found = planStripRoom({ box, count, hud: key })!;
        for (const block of key) expect(hits(found, block), `${name} ${count}`).toBe(false);
        expect(found.card).toBeGreaterThanOrEqual(96);
      }
    }
  });

  it("falls back to smaller tiles before it covers the HUD", () => {
    const box = BOXES["1366x768"];
    // A band of 420 px is clear between the plates above and the hand below: the wanted tiles need more.
    const key = [rect(0, 0, box.width, 200)];
    const hand = rect(box.width / 2 - 170, box.height - 70, 340, 60);
    const found = planStripRoom({ box, count: 2, hud: key, hand })!;
    expect(hits(found, key[0])).toBe(false);
    expect(found.card).toBeLessThan(STRIP_ROOM.card);
    expect(found.card).toBeGreaterThanOrEqual(STRIP_ROOM.smaller[STRIP_ROOM.smaller.length - 1]);
  });

  it("starts from the anchor: the room is near it when the place is clear", () => {
    const box = BOXES["1920x1080"];
    const found = planStripRoom({ box, count: 5, anchor: { x: 400, y: 500 } })!;
    expect(Math.hypot(found.x + found.width / 2 - 400, found.y + found.height / 2 - 500)).toBeLessThan(40);
    const middle = planStripRoom({ box, count: 5 })!;
    expect(Math.abs(middle.x + middle.width / 2 - box.width / 2)).toBeLessThan(30);
  });

  it("covers the hand before it covers the key HUD", () => {
    const box = BOXES["1366x768"];
    const key = [rect(0, 0, box.width, 160)];
    const hand = rect(100, 300, 1100, 200);
    const found = planStripRoom({ box, count: 2, hud: key, hand })!;
    expect(hits(found, key[0])).toBe(false);
  });

  it("returns nothing for an empty box or no cards", () => {
    expect(planStripRoom({ box: { width: 0, height: 500 }, count: 2 })).toBeUndefined();
    expect(planStripRoom({ box: BOXES["1920x1080"], count: 0 })).toBeUndefined();
  });

  it("plans quickly even when nothing is clear", () => {
    const box = BOXES["2560x1440"];
    const blocks = [rect(0, 0, box.width, box.height)];
    const started = performance.now();
    const found = planStripRoom({ box, count: 14, hud: blocks, soft: blocks, hand: rect(1000, 1200, 500, 120) });
    expect(found).toBeDefined();
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("the stage css gives the response panel its room and large cards", () => {
  const stage = readFileSync(join(__dirname, "../src/components/duel/table/table-stage.module.css"), "utf8");
  const strip = readFileSync(join(__dirname, "../src/components/duel/card-strip.module.css"), "utf8");

  it("places the chain-response panel in the --sr-* room and scrolls the grid inside it", () => {
    expect(stage).toContain('.board[data-strip-room][data-strip-room][data-strip-room]');
    expect(stage).toMatch(/inset: var\(--sr-y\) auto calc\(100% - var\(--sr-y\) - var\(--sr-h\)\) var\(--sr-x\);/);
    expect(stage).toMatch(/width: var\(--sr-w\);/);
    expect(stage).toMatch(/max-height: var\(--sr-h\);/);
  });

  it("sizes the tiles from --sr-card, not from the pair unit", () => {
    expect(strip).toMatch(/\[data-strip-room\]\) \.wrap\[data-tone="chain"\] \{[^}]*--cs-w: var\(--sr-card, 130px\);/);
    expect(strip).toMatch(/\[data-strip-room\]\) \.wrap\[data-tone="chain"\] \.strip \{[^}]*overflow-y: auto;/);
  });
});
