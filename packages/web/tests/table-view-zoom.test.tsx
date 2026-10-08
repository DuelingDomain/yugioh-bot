// @vitest-environment jsdom
import React, { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewZoom, VIEW_OCCLUDERS } from "@/components/duel/table/use-view-zoom";
import { ViewReset } from "@/components/duel/table/view-reset";
import {
  clampView,
  DRAG_THRESHOLD_PX,
  edgeInsets,
  counterTransform,
  fitView,
  followCss,
  isZoomed,
  layerOffset,
  layerTransform,
  panBy,
  pinchView,
  PressSplit,
  stepView,
  VIEW_IDENTITY,
  VIEW_ZOOM,
  visibleRect,
  wheelFactor,
  zoomAt,
} from "@/components/duel/table/view-zoom";

const BOX = { width: 1000, height: 600 };

describe("view clamps", () => {
  it("keeps the scale between the camera fit and 2.5 times it", () => {
    expect(VIEW_ZOOM.min).toBe(1);
    expect(VIEW_ZOOM.max).toBe(2.5);
    expect(clampView({ s: 0.4, x: -50, y: 20 }, BOX)).toEqual({ s: 1, x: 0, y: 0 });
    expect(clampView({ s: 9, x: -100, y: -100 }, BOX).s).toBe(2.5);
  });

  it("never lets an edge of a zoomed board into the box", () => {
    // At 2x the board is 2000 x 1200: x is between -1000 and 0, y between -600 and 0.
    expect(clampView({ s: 2, x: 50, y: 30 }, BOX)).toEqual({ s: 2, x: 0, y: 0 });
    expect(clampView({ s: 2, x: -5000, y: -5000 }, BOX)).toEqual({ s: 2, x: -1000, y: -600 });
    expect(clampView({ s: 2, x: -400, y: -200 }, BOX)).toEqual({ s: 2, x: -400, y: -200 });
  });

  it("does not pan an unzoomed board", () => {
    expect(panBy(VIEW_IDENTITY, 200, -80, BOX)).toEqual({ s: 1, x: 0, y: 0 });
  });

  it("pans a zoomed board inside the clamps", () => {
    const view = { s: 2, x: -500, y: -300 };
    expect(panBy(view, 100, -50, BOX)).toEqual({ s: 2, x: -400, y: -350 });
    expect(panBy(view, 900, 900, BOX)).toEqual({ s: 2, x: 0, y: 0 });
  });

  it("drops a bad number to the camera pose", () => {
    expect(clampView({ s: Number.NaN, x: Number.NaN, y: 3 }, BOX)).toEqual({ s: 1, x: 0, y: 0 });
  });
});

describe("zoom about a point", () => {
  it("keeps the board point under the pointer", () => {
    const point = { x: 300, y: 200 };
    const next = zoomAt(VIEW_IDENTITY, point, 2, BOX);
    expect(next.s).toBe(2);
    // The board point (300, 200) shows at x + s * 300 = 300.
    expect(next.x + next.s * 300).toBeCloseTo(300);
    expect(next.y + next.s * 200).toBeCloseTo(200);
  });

  it("clamps at the limits, and zooming out at the least scale goes home", () => {
    expect(zoomAt(VIEW_IDENTITY, { x: 10, y: 10 }, 100, BOX).s).toBe(2.5);
    expect(zoomAt({ s: 2, x: -300, y: -100 }, { x: 0, y: 0 }, 0.1, BOX)).toEqual({ s: 1, x: 0, y: 0 });
  });

  it("turns a wheel step into a factor: down zooms out, up zooms in, a pinch is finer", () => {
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(-100, 0, false)).toBeCloseTo(Math.exp(0.15));
    // A line-mode notch is as strong as about 3 lines of 16 px.
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(Math.exp(48 * 0.0015));
    expect(wheelFactor(-10, 0, true)).toBeCloseTo(Math.exp(0.1));
  });

  it("pinches about the midpoint of the fingers", () => {
    const next = pinchView(VIEW_IDENTITY, { x: 400, y: 300 }, { x: 600, y: 300 }, { x: 300, y: 300 }, { x: 700, y: 300 }, BOX);
    expect(next.s).toBe(2);
    expect(next.x + next.s * 500).toBeCloseTo(500);
  });
});

describe("view helpers", () => {
  it("writes no transform for the camera pose", () => {
    expect(layerTransform(VIEW_IDENTITY)).toBe("");
    expect(layerTransform({ s: 2, x: -100, y: -50 })).toBe("translate(-100.00px, -50.00px) scale(2.0000)");
  });

  it("maps the view through a fitted canvas", () => {
    // Canvas at (100, 20) scaled 0.5: u = (x + (s - 1) * 100) / 0.5.
    expect(layerTransform({ s: 2, x: -300, y: -40 }, { x: 100, y: 20, k: 0.5 })).toBe("translate(-400.00px, -40.00px) scale(2.0000)");
  });

  it("finds the part of a rect on the screen after the zoom", () => {
    const view = { s: 2, x: -500, y: -300 };
    expect(visibleRect(view, { x: 0, y: 0, width: 400, height: 300 }, BOX)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    expect(visibleRect(view, { x: 0, y: 0, width: 100, height: 100 }, BOX)).toBeNull();
  });

  it("eases toward the target and lands on it", () => {
    let view = VIEW_IDENTITY;
    const target = { s: 2, x: -100, y: -100 };
    for (let i = 0; i < 60 && view !== target; i += 1) view = stepView(view, target, 16, 70);
    expect(view).toBe(target);
    expect(isZoomed(view)).toBe(true);
  });
});

describe("HUD that follows the board", () => {
  it("puts the anchor of a plate where the zoom takes that board point, at the plate's own size", () => {
    const frame = { x: 40, y: 10, k: 0.8 };
    const view = { s: 2, x: -300, y: -120 };
    const u = layerOffset(view, frame);
    // A board point q (px of the layer's parent) goes to u + s * q; the follow offset is u + (s - 1) * q.
    const q = { x: 210, y: 95 };
    const on = { x: frame.x + frame.k * (u.x + view.s * q.x), y: frame.y + frame.k * (u.y + view.s * q.y) };
    expect(on.x).toBeCloseTo(view.x + view.s * (frame.x + frame.k * q.x), 6);
    expect(on.y).toBeCloseTo(view.y + view.s * (frame.y + frame.k * q.y), 6);
    expect(followCss(200, 210, "x")).toBe("calc(200px + var(--vz-x, 0px) + (var(--vz-s, 1) - 1) * 210px)");
  });

  it("keeps a plate inside the zoomed box of its place, so it covers no card it did not cover at rest", () => {
    // Plate 100 px wide at x 300, anchor in its middle: at 2.5x its box is inside the zoomed 300..400 box.
    const s = 2.5;
    const u = layerOffset({ s, x: -700, y: 0 });
    const left = 300 + u.x + (s - 1) * 350;
    expect(left).toBeGreaterThanOrEqual(u.x + s * 300);
    expect(left + 100).toBeLessThanOrEqual(u.x + s * 400);
  });
});

describe("safe frame", () => {
  const HUD = { top: 0, right: 120, bottom: 80, left: 0 };

  it("changes nothing at rest", () => {
    expect(clampView({ s: 1, x: -50, y: -50 }, BOX, HUD)).toEqual({ s: 1, x: 0, y: 0 });
  });

  it("lets a zoomed board edge come in under the HUD, by the zoom past 1x up to the whole inset", () => {
    // At 2x: x from 1000 * (1 - 2) - 120 = -1120 to 0; y from -600 - 80 = -680 to 0.
    expect(clampView({ s: 2, x: -5000, y: -5000 }, BOX, HUD)).toEqual({ s: 2, x: -1120, y: -680 });
    // At 1.25x half of it: x down to -250 - 60.
    expect(clampView({ s: 1.25, x: -5000, y: 0 }, BOX, HUD).x).toBeCloseTo(-310, 6);
    expect(panBy({ s: 2, x: -1000, y: 0 }, -500, 0, BOX, HUD).x).toBe(-1120);
  });

  it("gives each HUD rect to the edge where it costs the least room", () => {
    const insets = edgeInsets(
      [
        { x: 860, y: 450, width: 140, height: 150 }, // bottom-right corner cluster: the right edge (140 x 600 < 150 x 1000)
        { x: 300, y: 540, width: 300, height: 60 }, // a bar at the bottom
        { x: -20, y: 10, width: 10, height: 10 }, // off the box
      ],
      BOX,
    );
    expect(insets).toEqual({ top: 0, right: 140, bottom: 60, left: 0 });
  });

  it("leaves out a HUD rect that is not at an edge, as a prompt panel in the middle of the box", () => {
    // Its cheapest band (the top, 390 deep) is past a quarter of the 600 px height: no inset at all.
    expect(edgeInsets([{ x: 320, y: 220, width: 360, height: 170 }], BOX)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    // A bar near the bottom still counts.
    expect(edgeInsets([{ x: 300, y: 470, width: 400, height: 92 }], BOX).bottom).toBe(130);
  });
});

describe("press split", () => {
  it("is a click when the pointer moves no more than the threshold", () => {
    const split = new PressSplit();
    split.down({ x: 10, y: 10 });
    expect(split.move({ x: 10 + DRAG_THRESHOLD_PX, y: 10 })).toBe("idle");
    expect(split.move({ x: 14, y: 14 })).toBe("idle");
    expect(split.up()).toBe("click");
  });

  it("is a drag once it passes the threshold, also when it comes back", () => {
    const split = new PressSplit();
    split.down({ x: 10, y: 10 });
    expect(split.move({ x: 17, y: 10 })).toBe("start");
    expect(split.move({ x: 30, y: 10 })).toBe("drag");
    expect(split.move({ x: 10, y: 10 })).toBe("drag");
    expect(split.up()).toBe("drag");
  });

  it("is neither when cancelled, and nothing without a press", () => {
    const split = new PressSplit();
    expect(split.move({ x: 50, y: 50 })).toBe("idle");
    expect(split.up()).toBeNull();
    split.down({ x: 0, y: 0 });
    split.cancel();
    expect(split.up()).toBeNull();
  });
});

describe("useViewZoom on a board", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(BOX.width);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(BOX.height);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: BOX.width, bottom: BOX.height, width: BOX.width, height: BOX.height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function Board({ onZone, onBoard, reducedMotion = true, resetKey = "a", hud = false, onZoom }: { onZone: () => void; onBoard: () => void; reducedMotion?: boolean; resetKey?: string; hud?: boolean; onZoom?: (zoom: ReturnType<typeof useViewZoom>) => void }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const zoom = useViewZoom({ rootRef, layerRef, enabled: true, reducedMotion, resetKey });
    onZoom?.(zoom);
    return (
      <div ref={rootRef} data-testid="root" data-scale={zoom.view.s.toFixed(2)} onClick={onBoard}>
        <div ref={layerRef} data-testid="layer">
          <button type="button" data-testid="zone" data-zones="0:4:0" onClick={onZone}>
            zone
          </button>
          <div data-testid="floor" />
        </div>
        <div data-slot="prompt">
          <button type="button" data-testid="prompt">yes</button>
        </div>
        {hud ? <div data-zoom-occluder data-testid="hud" /> : null}
        <div data-vz-follow="" data-testid="plate" />
      </div>
    );
  }

  const press = (node: Element, from: [number, number], to: [number, number], pointerType = "mouse") => {
    fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: from[0], clientY: from[1], pointerType });
    fireEvent.pointerMove(node, { pointerId: 1, clientX: to[0], clientY: to[1], pointerType });
    fireEvent.pointerUp(node, { pointerId: 1, clientX: to[0], clientY: to[1], pointerType });
    fireEvent.click(node, { clientX: to[0], clientY: to[1] });
  };

  it("zooms with the wheel about the pointer and blocks the page zoom", () => {
    const { getByTestId } = render(<Board onZone={() => undefined} onBoard={() => undefined} />);
    const root = getByTestId("root");
    const event = new WheelEvent("wheel", { deltaY: -400, clientX: 500, clientY: 300, bubbles: true, cancelable: true, ctrlKey: true });
    act(() => {
      root.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(Number(root.dataset.scale)).toBeGreaterThan(1.5);
    expect(getByTestId("layer").style.transform).toContain("scale(");
    expect(root.dataset.viewZoomed).toBe("true");
  });

  it("lets a short press on a zone click it, and moves nothing", () => {
    const onZone = vi.fn();
    const { getByTestId } = render(<Board onZone={onZone} onBoard={() => undefined} />);
    act(() => press(getByTestId("zone"), [100, 100], [104, 103]));
    expect(onZone).toHaveBeenCalledTimes(1);
    expect(getByTestId("layer").style.transform).toBe("");
  });

  it("drops the click of a drag that starts on a zone, so it pans and selects nothing", () => {
    const onZone = vi.fn();
    const onBoard = vi.fn();
    const { getByTestId } = render(<Board onZone={onZone} onBoard={onBoard} />);
    const root = getByTestId("root");
    act(() => {
      root.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, clientX: 500, clientY: 300, bubbles: true, cancelable: true }));
    });
    const before = getByTestId("layer").style.transform;
    act(() => press(getByTestId("zone"), [300, 300], [380, 340]));
    expect(onZone).not.toHaveBeenCalled();
    expect(onBoard).not.toHaveBeenCalled();
    expect(getByTestId("layer").style.transform).not.toBe(before);
    // The next press is a new one: its click goes through.
    act(() => press(getByTestId("zone"), [300, 300], [300, 300]));
    expect(onZone).toHaveBeenCalledTimes(1);
  });

  it("leaves the prompt alone: no pan starts there and its click goes through", () => {
    const onBoard = vi.fn();
    const { getByTestId } = render(<Board onZone={() => undefined} onBoard={onBoard} />);
    act(() => press(getByTestId("prompt"), [100, 100], [180, 100]));
    expect(onBoard).toHaveBeenCalledTimes(1);
  });

  it("does not pan an unzoomed board with one finger, and a tap still acts", () => {
    const onZone = vi.fn();
    const { getByTestId } = render(<Board onZone={onZone} onBoard={() => undefined} />);
    act(() => press(getByTestId("zone"), [100, 100], [102, 101], "touch"));
    expect(onZone).toHaveBeenCalledTimes(1);
    expect(getByTestId("root").style.touchAction).toBe("none");
  });

  it("resets on a double-click on empty board space and on a new layout, not on a double-click on a card", () => {
    const { getByTestId, rerender } = render(<Board onZone={() => undefined} onBoard={() => undefined} />);
    const root = getByTestId("root");
    const zoomIn = () =>
      act(() => {
        root.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, clientX: 500, clientY: 300, bubbles: true, cancelable: true }));
      });
    zoomIn();
    act(() => {
      fireEvent.doubleClick(getByTestId("zone"));
    });
    expect(root.dataset.scale).not.toBe("1.00");
    act(() => {
      fireEvent.doubleClick(getByTestId("floor"));
    });
    expect(root.dataset.scale).toBe("1.00");
    zoomIn();
    expect(root.dataset.scale).not.toBe("1.00");
    rerender(<Board onZone={() => undefined} onBoard={() => undefined} resetKey="b" />);
    expect(root.dataset.scale).toBe("1.00");
    expect(getByTestId("layer").style.transform).toBe("");
  });

  it("eases a view that the HUD let past the new clamps back in when the HUD goes (refit)", () => {
    // The HUD bar: the bottom 60 px of the box.
    const rect = (x: number, y: number, width: number, height: number) => ({ left: x, top: y, right: x + width, bottom: y + height, width, height, x, y, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.dataset.zoomOccluder != null ? rect(0, 540, BOX.width, 60) : rect(0, 0, BOX.width, BOX.height);
    });
    let zoom: ReturnType<typeof useViewZoom> | null = null;
    const keep = (z: ReturnType<typeof useViewZoom>) => {
      zoom = z;
    };
    const { getByTestId, rerender } = render(<Board onZone={() => undefined} onBoard={() => undefined} hud onZoom={keep} />);
    const root = getByTestId("root");
    act(() => {
      root.dispatchEvent(new WheelEvent("wheel", { deltaY: -240, clientX: 500, clientY: 300, bubbles: true, cancelable: true, ctrlKey: true }));
    });
    // Pan to the bottom limit: the board edge comes in under the HUD bar.
    act(() => press(getByTestId("floor"), [500, 300], [500, -3000]));
    const s = zoom!.view.s;
    expect(zoom!.view.y).toBeCloseTo(BOX.height * (1 - s) - 60, 1);
    rerender(<Board onZone={() => undefined} onBoard={() => undefined} onZoom={keep} />);
    act(() => zoom!.refit());
    expect(zoom!.view.y).toBeCloseTo(BOX.height * (1 - s), 1);
  });

  it("keeps a refit that comes during a drag: the next move uses the new insets", () => {
    let hudOn = true;
    const rect = (x: number, y: number, width: number, height: number) => ({ left: x, top: y, right: x + width, bottom: y + height, width, height, x, y, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.zoomOccluder != null) return hudOn ? rect(0, 540, BOX.width, 60) : rect(0, 0, 0, 0);
      return rect(0, 0, BOX.width, BOX.height);
    });
    let zoom: ReturnType<typeof useViewZoom> | null = null;
    const { getByTestId } = render(<Board onZone={() => undefined} onBoard={() => undefined} hud onZoom={(z) => (zoom = z)} />);
    const root = getByTestId("root");
    act(() => {
      root.dispatchEvent(new WheelEvent("wheel", { deltaY: -240, clientX: 500, clientY: 300, bubbles: true, cancelable: true, ctrlKey: true }));
    });
    const floor = getByTestId("floor");
    act(() => {
      fireEvent.pointerDown(floor, { pointerId: 1, button: 0, clientX: 500, clientY: 300, pointerType: "mouse" });
      fireEvent.pointerMove(floor, { pointerId: 1, clientX: 500, clientY: -3000, pointerType: "mouse" });
    });
    // The HUD goes in the middle of the drag; the refit takes the board to the new limit.
    hudOn = false;
    act(() => zoom!.refit());
    act(() => {
      fireEvent.pointerMove(floor, { pointerId: 1, clientX: 500, clientY: -3010, pointerType: "mouse" });
      fireEvent.pointerUp(floor, { pointerId: 1, clientX: 500, clientY: -3010, pointerType: "mouse" });
    });
    const s = zoom!.view.s;
    expect(zoom!.view.y).toBeCloseTo(BOX.height * (1 - s), 1);
  });

  it("reads the HUD once per gesture, not on every move of a drag", () => {
    const { getByTestId } = render(<Board onZone={() => undefined} onBoard={() => undefined} hud />);
    const root = getByTestId("root");
    act(() => {
      root.dispatchEvent(new WheelEvent("wheel", { deltaY: -240, clientX: 500, clientY: 300, bubbles: true, cancelable: true, ctrlKey: true }));
    });
    const reads = vi.spyOn(document, "querySelectorAll");
    const floor = getByTestId("floor");
    act(() => {
      fireEvent.pointerDown(floor, { pointerId: 1, button: 0, clientX: 500, clientY: 300, pointerType: "mouse" });
      for (let i = 1; i <= 20; i += 1) fireEvent.pointerMove(floor, { pointerId: 1, clientX: 500 - i * 10, clientY: 300, pointerType: "mouse" });
      fireEvent.pointerUp(floor, { pointerId: 1, clientX: 300, clientY: 300, pointerType: "mouse" });
    });
    expect(reads.mock.calls.filter(([selector]) => selector === VIEW_OCCLUDERS)).toHaveLength(1);
  });

  it("writes the follow vars on the followers each frame, and on the root only at rest", () => {
    const { getByTestId } = render(<Board onZone={() => undefined} onBoard={() => undefined} />);
    const root = getByTestId("root");
    const plate = getByTestId("plate");
    const vx = (node: HTMLElement) => node.style.getPropertyValue("--vz-x");
    act(() => {
      root.dispatchEvent(new WheelEvent("wheel", { deltaY: -240, clientX: 500, clientY: 300, bubbles: true, cancelable: true, ctrlKey: true }));
    });
    expect(vx(root)).not.toBe("");
    expect(vx(plate)).toBe(vx(root));
    const rested = vx(root);
    const floor = getByTestId("floor");
    act(() => {
      fireEvent.pointerDown(floor, { pointerId: 1, button: 0, clientX: 500, clientY: 300, pointerType: "mouse" });
      fireEvent.pointerMove(floor, { pointerId: 1, clientX: 400, clientY: 300, pointerType: "mouse" });
    });
    // Mid-drag: the plate moves, the root (and the board under it) keeps its style.
    expect(vx(plate)).not.toBe(rested);
    expect(vx(root)).toBe(rested);
    act(() => {
      fireEvent.pointerUp(floor, { pointerId: 1, clientX: 400, clientY: 300, pointerType: "mouse" });
    });
    expect(vx(root)).toBe(vx(plate));
  });

  it("eases without reduced motion", () => {
    const { getByTestId } = render(<Board onZone={() => undefined} onBoard={() => undefined} reducedMotion={false} />);
    const root = getByTestId("root");
    act(() => {
      root.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, clientX: 500, clientY: 300, bubbles: true, cancelable: true }));
    });
    // Nothing at rest yet: the ease runs on animation frames.
    expect(root.dataset.scale).toBe("1.00");
    let time = 0;
    act(() => {
      for (let i = 0; i < 200 && frames.length > 0; i += 1) {
        const next = frames.shift()!;
        time += 16;
        next(time);
      }
    });
    expect(Number(root.dataset.scale)).toBeGreaterThan(1.4);
  });
});

describe("Reset view control", () => {
  afterEach(() => cleanup());

  it("gives the focus back to the board when a click hides it", () => {
    function Host() {
      const board = useRef<HTMLDivElement>(null);
      const [zoomed, setZoomed] = React.useState(true);
      return (
        <div ref={board} tabIndex={-1} data-testid="board">
          <ViewReset zoomed={zoomed} scale={2} onReset={() => setZoomed(false)} board={board} />
        </div>
      );
    }
    const { getByTestId, queryByTestId } = render(<Host />);
    const button = getByTestId("view-reset");
    button.focus();
    act(() => {
      fireEvent.click(button);
    });
    expect(queryByTestId("view-reset")).toBeNull();
    expect(document.activeElement).toBe(getByTestId("board"));
  });
});

describe("camera fit of a field", () => {
  const FREE = { x: 100, y: 50, width: 800, height: 400 };

  it("fills the free box with the field and centres it", () => {
    const view = fitView([{ rect: { x: 300, y: 200, width: 200, height: 100 } }], FREE);
    // Width allows 4x, height allows 4x, so the cap of 2.5 is the limit.
    expect(view.s).toBe(2.5);
    const l = view.x + view.s * 300;
    const t = view.y + view.s * 200;
    expect(l + (view.s * 200) / 2).toBeCloseTo(FREE.x + FREE.width / 2);
    expect(t + (view.s * 100) / 2).toBeCloseTo(FREE.y + FREE.height / 2);
  });

  it("takes the largest scale that fits both sides", () => {
    const view = fitView([{ rect: { x: 0, y: 0, width: 400, height: 300 } }], FREE);
    expect(view.s).toBeCloseTo(400 / 300, 3);
    expect(view.s * 300).toBeLessThanOrEqual(FREE.height + 0.01);
  });

  it("keeps a following plate at its own size, so it does not grow the field's share", () => {
    const field = { rect: { x: 0, y: 100, width: 300, height: 200 } };
    const plate = { rect: { x: 0, y: 0, width: 100, height: 80 }, anchor: { x: 0, y: 100 } };
    const view = fitView([field, plate], FREE);
    const topOfPlate = view.y + view.s * 100 - 100;
    expect(topOfPlate).toBeGreaterThanOrEqual(FREE.y - 0.01);
    expect(view.y + view.s * 300).toBeLessThanOrEqual(FREE.y + FREE.height + 0.01);
  });

  it("never goes under the camera scale and returns identity with nothing to fit", () => {
    expect(fitView([], FREE)).toEqual(VIEW_IDENTITY);
    const big = fitView([{ rect: { x: 0, y: 0, width: 2000, height: 1000 } }], FREE);
    expect(big.s).toBe(1);
  });

  it("draws a counter-scaled node at its 1x place", () => {
    expect(counterTransform(VIEW_IDENTITY, { x: 10, y: 20 })).toBe("");
    const view = { s: 2, x: -300, y: -100 };
    const origin = { x: 40, y: 60 };
    const css = counterTransform(view, origin);
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(css)!;
    const [tx, ty, sc] = [Number(m[1]), Number(m[2]), Number(m[3])];
    expect(sc).toBeCloseTo(0.5);
    // The layer maps p to u + s * p: the node's top left lands back on its origin.
    const u = layerOffset(view);
    expect(u.x + view.s * (origin.x + tx)).toBeCloseTo(origin.x, 1);
    expect(u.y + view.s * (origin.y + ty)).toBeCloseTo(origin.y, 1);
  });
});
