// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { EDGE_LEFT_PX, GAP_PX, MIN_WIDTH_PX, WIDTH_PX, measureObstacles, obstaclesKey, peekPlaces, type Box } from "@/components/duel/table/peek-layout";

const layer: Box = { left: -32, top: 0, right: 1888, bottom: 1080 };
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
// The 1920 case of the owner screenshot: the compact chain panel at the left, the board from x=487.
const chain = box(132, 197, 424, 383);
const board = [box(487, 38, 1575, 1042)];

describe("the card peek lines up with the chain panel", () => {
  it("takes the left edge and the width of the chain panel, and stands below it with the gap", () => {
    const [first] = peekPlaces(layer, { board, keep: [chain], chain });
    expect(first.side).toBe("left");
    expect(first.left).toBe(chain.left - layer.left);
    expect(first.width).toBe(chain.right - chain.left);
    expect(first.top).toBe(chain.bottom + GAP_PX);
    expect(first.maxH).toBe(layer.bottom - 8 - first.top);
  });

  it("keeps the layer edge and the usual width with no chain panel", () => {
    const [first] = peekPlaces(layer, { board, keep: [], chain: null });
    expect(first.left).toBeUndefined();
    expect(first.width).toBe(WIDTH_PX);
    expect(layer.left + EDGE_LEFT_PX).toBe(40);
  });

  it("never makes the peek narrower than the minimum: a narrow chain panel gives its left edge, not its width", () => {
    for (const width of [142, 186, 214]) {
      const narrow = box(130, 131, 130 + width, 298);
      const [first] = peekPlaces(layer, { board, keep: [narrow], chain: narrow });
      expect(first.left).toBe(narrow.left - layer.left);
      expect(first.width).toBe(MIN_WIDTH_PX);
    }
  });

  it("holds a wide chain panel to the usual width", () => {
    const wide = box(100, 100, 500, 300);
    const [first] = peekPlaces(layer, { board: [box(600, 38, 1575, 1042)], keep: [wide], chain: wide });
    expect(first.width).toBe(WIDTH_PX);
  });

  it("keeps a gap to the board: it narrows when the board is more than the slack nearer, and keeps the old column when 220 px do not fit", () => {
    const column = box(130, 131, 130 + 292, 298);
    // The board is 8 px nearer than the gap allows: the width stays. 9 px nearer: it narrows by that.
    const slack = peekPlaces(layer, { board: [box(column.right + GAP_PX - 8, 28, 1575, 1042)], keep: [column], chain: column });
    expect(slack[0].width).toBe(292);
    const nearer = peekPlaces(layer, { board: [box(column.right + GAP_PX - 9, 28, 1575, 1042)], keep: [column], chain: column });
    expect(nearer[0].width).toBe(283);
    // The board leaves under 220 px beside the chain panel: the left column of the layer takes the peek (below the chain panel).
    const tight = peekPlaces(layer, { board: [box(130 + 220 + GAP_PX - 1, 28, 1575, 1042)], keep: [column], chain: column });
    expect(tight[0].left).toBeUndefined();
    expect(tight[0].side).toBe("left");
    expect(tight[0].width).toBeGreaterThanOrEqual(MIN_WIDTH_PX);
    expect(tight[0].top).toBe(column.bottom + GAP_PX);
  });

  it("is placed again when the chain panel moves sideways", () => {
    const base = { board, keep: [chain] };
    expect(obstaclesKey({ ...base, chain })).not.toBe(obstaclesKey({ ...base, chain: box(chain.left + 20, chain.top, chain.right + 20, chain.bottom) }));
  });
});

describe("measuring the chain panel", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  const panel = (rect: Box) => {
    const node = document.createElement("section");
    node.setAttribute("data-chain-panel", "");
    node.style.opacity = "1";
    node.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON: () => ({}) });
    document.body.append(node);
  };

  it("does not take the strip of the 1v1 table for the chain column", () => {
    panel(box(300, 20, 486, 120));
    document.querySelector("[data-chain-panel]")!.setAttribute("data-chain-strip-wrap", "true");
    expect(measureObstacles().chain).toBeNull();
  });

  it("reports a narrow panel in the left half and not a strip or a right panel", () => {
    panel(chain);
    expect(measureObstacles().chain).toEqual(chain);
    document.body.innerHTML = "";
    panel(box(300, 20, 1500, 120));
    expect(measureObstacles().chain).toBeNull();
    document.body.innerHTML = "";
    panel(box(1600, 200, 1892, 380));
    expect(measureObstacles().chain).toBeNull();
  });
});
