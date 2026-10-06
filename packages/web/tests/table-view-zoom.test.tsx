// @vitest-environment jsdom
import React, { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewZoom } from "@/components/duel/table/use-view-zoom";
import {
  clampView,
  DRAG_THRESHOLD_PX,
  isZoomed,
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

  function Board({ onZone, onBoard, reducedMotion = true, resetKey = "a" }: { onZone: () => void; onBoard: () => void; reducedMotion?: boolean; resetKey?: string }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const zoom = useViewZoom({ rootRef, layerRef, enabled: true, reducedMotion, resetKey });
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
