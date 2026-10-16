// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EDGE_LEFT_PX, EDGE_LEFT_TABS_PX, FLOOR_WIDTH_PX, GAP_PX, MAX_WIDTH_PX, MIN_WIDTH_PX, measureObstacles, obstaclesKey, peekColumnRight, peekPlaces, peekWidth, type Box } from "@/components/duel/table/peek-layout";

const layer = (width: number, height: number): Box => ({ left: 0, top: 0, right: width, bottom: height });
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe("the card peek column", () => {
  it("asks for 22% of the window, from 320 to 420 px (the size floor of the card panel)", () => {
    expect(MIN_WIDTH_PX).toBe(320);
    expect(MAX_WIDTH_PX).toBe(420);
    expect(peekWidth(1280)).toBe(MIN_WIDTH_PX);
    expect(peekWidth(1366)).toBe(MIN_WIDTH_PX);
    expect(peekWidth(1600)).toBe(352);
    expect(peekWidth(1920)).toBe(MAX_WIDTH_PX);
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
    const [first] = peekPlaces(layer(1920, 1080), { board: [box(520, 38, 1900, 1042)], keep: [] });
    expect(first.width).toBe(MAX_WIDTH_PX);
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
    // The bands (12 px gap round each part): 332-548 (216), 212-288 (76), 50-118 (68). The one of 10 px under the last part is too short.
    expect(places.map((place) => [place.top, place.maxH])).toEqual([[332, 216], [212, 76], [50, 68]]);
    for (const place of places) expect(place.side).toBe("left");
  });

  it("keeps a gap to the board when the board is nearer than the column", () => {
    const [first] = peekPlaces(layer(1920, 1080), { board: [box(400, 38, 1900, 1042)], keep: [] });
    expect(first.width).toBe(400 - GAP_PX - EDGE_LEFT_PX);
  });

  it("never makes the panel narrower than the floor, even when the board is nearer", () => {
    const [first] = peekPlaces(layer(1366, 768), { board: [box(200, 38, 1350, 740)], keep: [] });
    expect(first.width).toBe(FLOOR_WIDTH_PX);
  });

  it("is as wide as the free room up to the own field zones, and the rival board does not limit it", () => {
    const rival = box(200, 38, 1350, 400);
    const own = box(420, 500, 1350, 740);
    const [first] = peekPlaces(layer(1920, 1080), { board: [rival, own], keep: [], own: [own] });
    expect(first.width).toBe(420 - GAP_PX - EDGE_LEFT_PX);
    const [open] = peekPlaces(layer(1920, 1080), { board: [rival, own], keep: [], own: [box(900, 500, 1350, 740)] });
    expect(open.width).toBe(MAX_WIDTH_PX);
  });

  it("stands over the Deck Master plate: only the kept parts cut the band (the plate is no kept part)", () => {
    const l = layer(1920, 1080);
    const board = [box(520, 38, 1900, 1042)];
    // The plate (bottom left, 14..320 x 756..1066) is not measured as a kept part, so the band runs down to the bottom of the layer.
    const [first] = peekPlaces(l, { board, keep: [box(14, 170, 162, 330)] });
    expect(first.top + first.maxH).toBe(1080 - 8);
    // The same plate as a kept part cuts the band: the panel would stop above it.
    const [cut] = peekPlaces(l, { board, keep: [box(14, 170, 162, 330), box(14, 756, 320, 1066)] });
    expect(cut.top + cut.maxH).toBeLessThanOrEqual(756 - GAP_PX);
  });

  it("starts right of the edge tabs when the HUD has drawers instead of a dock (the 4-way grid)", () => {
    expect(EDGE_LEFT_TABS_PX).toBeLessThan(EDGE_LEFT_PX);
    const own = box(400, 500, 1350, 740);
    const [dock] = peekPlaces(layer(1920, 1080), { board: [own], keep: [], own: [own] });
    const [tabs] = peekPlaces(layer(1920, 1080), { board: [own], keep: [], own: [own] }, EDGE_LEFT_TABS_PX);
    expect(dock.width).toBe(400 - GAP_PX - EDGE_LEFT_PX);
    expect(tabs.width).toBe(400 - GAP_PX - EDGE_LEFT_TABS_PX);
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
  const part = (attribute: string, rect: Box, value = "") => {
    const node = document.createElement("div");
    node.setAttribute(attribute, value);
    node.style.opacity = "1";
    node.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON: () => ({}) });
    document.body.append(node);
  };

  it("does not keep clear of the Deck Master plates: the panel may cover them while it shows a card", () => {
    part("data-testid", box(14, 756, 320, 1066), "hud-master");
    expect(measureObstacles().keep).toHaveLength(0);
  });

  it("is at least 300 px wide in Tag, where the Extra Deck and Field piles stand at the left of the own board", () => {
    const monster = box(520, 500, 580, 580);
    const [first] = peekPlaces(layer(1366, 768), { board: [monster, box(309, 500, 369, 580)], keep: [], own: [monster] });
    expect(first.width).toBeGreaterThanOrEqual(300);
  });

  it("stops short of the card it shows, and keeps clear of it in the bands when no room is left", () => {
    const wide = peekPlaces(layer(1920, 1080), { board: [], keep: [], target: box(430, 400, 490, 480) });
    expect(wide[0].width).toBe(430 - GAP_PX - EDGE_LEFT_PX);
    const near = peekPlaces(layer(1920, 1080), { board: [], keep: [], target: box(200, 400, 260, 480) });
    expect(near.every((place) => place.width >= FLOOR_WIDTH_PX)).toBe(true);
    expect(near[0].top + near[0].maxH).toBeLessThanOrEqual(400 - GAP_PX);
  });

  it("computes the bands over the final width, not the requested one", () => {
    const limit = box(400, 500, 1350, 740);
    const blocker = box(430, 100, 520, 200);
    const [first] = peekPlaces(layer(1920, 1080), { board: [limit], keep: [blocker], own: [limit] });
    expect(first.width).toBe(400 - GAP_PX - EDGE_LEFT_PX);
    expect(first.top).toBe(50);
  });

  it("measures the field zones of the own seats only (a pile of two kinds counts for its seat)", () => {
    const zone = (key: string, rect: Box) => part("data-zones", rect, key);
    zone("0:4:0", box(400, 500, 460, 580));
    zone("1:4:0", box(300, 100, 360, 180));
    zone("0:8:3", box(420, 700, 480, 780));
    zone("0:256:0 0:8:5", box(380, 700, 440, 780));
    zone("0:64:0", box(300, 700, 360, 780));
    zone("", box(200, 300, 260, 360));
    // Only Monster Zones and Spell/Trap Zones 0-4 limit the width: the piles (Field 0:8:5, Extra Deck 0:64:0, GY) may be covered.
    expect(measureObstacles(null, false, [0]).own).toEqual([box(400, 500, 460, 580), box(420, 700, 480, 780)]);
    expect(measureObstacles(null, false, [1]).own).toEqual([box(300, 100, 360, 180)]);
    expect(measureObstacles().own).toBeUndefined();
  });

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
    expect(css).toContain("--pv-col-w: clamp(320px, 22vw, 420px)");
    expect(css).not.toContain('.preview[data-side="right"]');
    expect(css).not.toContain("--pv-right");
  });

  it("lets the card art of the Card panel grow with the pane (the 3D mode now shows it in an edge drawer)", () => {
    expect(read("inspector.module.css")).toContain("min(calc(170 * var(--duel-unit, 1px)), 44%)");
  });

  it("keeps the 1v1 board clear of the corner stack by --hud-left, not by a fixed number", () => {
    const css = read("room.module.css");
    expect(css).toContain("--hud-corner-need: calc(var(--hud-left) + 384px + var(--hud-board-w) - 100vw)");
    expect(css).not.toContain("--hud-right-need: calc(520px");
  });

  it("keeps the board of the generic floating HUD right of the column, while the edge-drawer shells reserve none", () => {
    expect(read("table/table-shell.module.css")).toContain(`--hud-left: ${COLUMN}`);
    // The 1v1 room, the Tag table, the 3-way plaza and the 4-way grid keep the card peek in a drawer or over the board.
    for (const file of ["tag/tag-shell.module.css", "room.module.css"]) {
      expect(read(file), file).toContain("--hud-left: 14px");
    }
    expect(read("table/table-shell.module.css")).toContain("--hud-left: 30px");
  });
});
