// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EDGE_LEFT_PX, GAP_PX, MAX_WIDTH_PX, MIN_WIDTH_PX, measureObstacles, obstaclesKey, peekColumnRight, peekPlaces, peekWidth, type Box } from "@/components/duel/table/peek-layout";

const layer = (width: number, height: number): Box => ({ left: 0, top: 0, right: width, bottom: height });
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe("the card peek column", () => {
  it("is 14% of the window wide, from 220 to 284 px", () => {
    expect(peekWidth(1280)).toBe(MIN_WIDTH_PX);
    expect(peekWidth(1366)).toBe(MIN_WIDTH_PX);
    expect(peekWidth(1920)).toBe(269);
    expect(peekWidth(2560)).toBe(MAX_WIDTH_PX);
  });

  it("ends 12 px before the board: the shells keep the board right of it", () => {
    expect(peekColumnRight(1366)).toBe(EDGE_LEFT_PX + 220 + GAP_PX);
    expect(peekColumnRight(2560)).toBe(EDGE_LEFT_PX + 284 + GAP_PX);
  });

  it("always stands at the left, whatever is on the table", () => {
    const l = layer(1920, 1080);
    const board = [box(353, 38, 1900, 1042)];
    for (const keep of [[], [box(14, 170, 162, 526)], [box(0, 0, 60, 170), box(14, 700, 230, 1060)]]) {
      const places = peekPlaces(l, { board, keep });
      expect(places.length).toBeGreaterThan(0);
      for (const place of places) expect(place.side).toBe("left");
    }
  });

  it("takes the whole free height of the column with nothing in it", () => {
    const [first] = peekPlaces(layer(1920, 1080), { board: [box(353, 38, 1900, 1042)], keep: [] });
    expect(first.width).toBe(269);
    expect(first.top).toBe(50);
    expect(first.maxH).toBeGreaterThan(900);
  });

  it("stands in the band below the chain tower and above the Deck Master plate", () => {
    const tower = box(14, 170, 162, 330);
    const plate = box(14, 800, 240, 1066);
    const places = peekPlaces(layer(1920, 1080), { board: [box(353, 38, 1900, 1042)], keep: [tower, plate] });
    const band = places.find((place) => place.top >= tower.bottom + GAP_PX);
    expect(band).toBeDefined();
    expect(band!.top + band!.maxH).toBeLessThanOrEqual(plate.top - GAP_PX);
    for (const place of places) expect(place.top >= tower.bottom || place.top + place.maxH <= tower.top).toBe(true);
  });

  it("keeps a gap to the board when the board is nearer than the column", () => {
    const [first] = peekPlaces(layer(1920, 1080), { board: [box(330, 38, 1900, 1042)], keep: [] });
    expect(first.width).toBe(330 - GAP_PX - EDGE_LEFT_PX);
  });

  it("never makes the panel narrower than the minimum", () => {
    const [first] = peekPlaces(layer(1366, 768), { board: [box(200, 38, 1350, 740)], keep: [] });
    expect(first.width).toBe(MIN_WIDTH_PX);
  });

  it("gives no place for a layer with no size (the CSS places the panel)", () => {
    expect(peekPlaces(layer(0, 0), { board: [], keep: [] })).toEqual([]);
  });

  it("is placed again when a kept part moves", () => {
    const base = { board: [box(353, 38, 1900, 1042)] };
    expect(obstaclesKey({ ...base, keep: [box(14, 170, 162, 330)] })).not.toBe(obstaclesKey({ ...base, keep: [box(34, 170, 182, 330)] }));
  });
});

describe("what the peek stays clear of", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  const part = (attribute: string, rect: Box) => {
    const node = document.createElement("div");
    node.setAttribute(attribute, "");
    node.style.opacity = "1";
    node.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON: () => ({}) });
    document.body.append(node);
  };

  it("keeps clear of the chain panel, the life-point plates and the phase hub", () => {
    part("data-chain-panel", box(14, 200, 230, 380));
    part("data-holo", box(900, 20, 1100, 110));
    part("data-hub-slot", box(800, 500, 1000, 560));
    part("data-hub", box(1200, 500, 1300, 560));
    expect(measureObstacles().keep).toHaveLength(4);
  });
});

describe("the CSS keeps the peek column free", () => {
  const read = (file: string) => readFileSync(join(__dirname, "../../src/components/duel", file), "utf8");
  const COLUMN = "calc(72px + clamp(220px, 14vw, 284px) + 12px)";

  it("has the same column width as peekWidth, and no right side variant", () => {
    const css = read("table/grid-hud.module.css");
    expect(css).toContain("--pv-col-w: clamp(220px, 14vw, 284px)");
    expect(css).not.toContain('.preview[data-side="right"]');
    expect(css).not.toContain("--pv-right");
  });

  it("keeps the board of the 4-way table, the Tag table and the 1v1 table right of the column", () => {
    for (const file of ["table/table-shell.module.css", "tag/tag-shell.module.css", "room.module.css"]) {
      expect(read(file), file).toContain(`--hud-left: ${COLUMN}`);
    }
  });
});
