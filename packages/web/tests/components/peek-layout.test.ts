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

  it("lists the short bands after the tall ones, still in the left column", () => {
    // The tower cuts the column: 50-158 (108 px, short) and 342-688 (346 px, tall) above a bar; under the bar is no room.
    const tower = box(14, 170, 162, 330);
    const bar = box(14, 700, 162, 704);
    const places = peekPlaces(layer(1366, 720), { board: [], keep: [tower, bar] });
    expect(places.map((place) => [place.top, place.maxH])).toEqual([[342, 346], [50, 108]]);
    for (const place of places) expect(place.side).toBe("left");
  });

  it("uses the tallest short bands, tallest first, when no band is tall", () => {
    const places = peekPlaces(layer(1366, 600), { board: [], keep: [box(14, 130, 162, 200), box(14, 300, 162, 320), box(14, 560, 162, 570)] });
    expect(places.map((place) => place.maxH)).toEqual([...places.map((place) => place.maxH)].sort((a, b) => b - a));
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) expect(place.side).toBe("left");
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

  it("keeps clear of the chain panel and the phase hub, and of the life-point plates only for a pin", () => {
    part("data-chain-panel", box(14, 200, 230, 380));
    part("data-holo", box(900, 20, 1100, 110));
    part("data-hub-slot", box(800, 500, 1000, 560));
    part("data-hub", box(1200, 500, 1300, 560));
    expect(measureObstacles().keep).toHaveLength(3);
    expect(measureObstacles(null, true).keep).toHaveLength(4);
  });

  it("keeps the art of a hover in FFA3 at 1366 x 768: a life-point plate in the column does not cut the band", () => {
    // Ryo's plate: it starts at x 234, inside the column (72 to 292), and ends at y 360, and a team plate stands at 460.
    part("data-holo", box(234, 80, 400, 360));
    part("data-team-plate", box(14, 460, 240, 760));
    const l = layer(1366, 768);
    const [hover] = peekPlaces(l, measureObstacles());
    const [pin] = peekPlaces(l, measureObstacles(null, true));
    // Hover: the band from the header pills (50) to the team plate (448) is 398 px tall; art, text and owner line need about 217 px.
    expect(hover.maxH).toBe(398);
    expect(hover.width).toBeGreaterThanOrEqual(MIN_WIDTH_PX);
    // The pin keeps clear of the plate: its band is the short one under the plate.
    expect(pin.maxH).toBe(76);
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

  it("keeps the 1v1 board clear of the corner stack by --hud-left, not by a fixed number", () => {
    const css = read("room.module.css");
    expect(css).toContain("--hud-right-need: calc(var(--hud-left) + 364px + 105.6dvh - 100vw)");
    expect(css).not.toContain("--hud-right-need: calc(520px");
  });

  it("keeps the board of the 4-way table, the Tag table and the 1v1 table right of the column", () => {
    for (const file of ["table/table-shell.module.css", "tag/tag-shell.module.css", "room.module.css"]) {
      expect(read(file), file).toContain(`--hud-left: ${COLUMN}`);
    }
  });
});
