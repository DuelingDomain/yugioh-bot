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

  it("keeps the chain panel width a few px over the board gap, and gives way only to a clearly nearer board", () => {
    const narrow = box(130, 131, 346, 298);
    const near = peekPlaces(layer, { board: [box(346 + GAP_PX - 8, 28, 1042, 680)], keep: [narrow], chain: narrow });
    expect(near[0].width).toBe(216);
    const tight = peekPlaces(layer, { board: [box(346 - 40, 28, 1042, 680)], keep: [narrow], chain: narrow });
    expect(tight[0].width).toBe(Math.max(MIN_WIDTH_PX, 216 - 40 - GAP_PX));
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
