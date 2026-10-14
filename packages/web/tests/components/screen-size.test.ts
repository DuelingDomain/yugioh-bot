// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { screenPose, screenSize } from "@/components/duel/attack-fx";

const BOX = { w: 100, h: 200 };

/**
 * jsdom has no layout. The box is a `BOX.w` x `BOX.h` card turned by `turnDeg` and scaled by `scale`; a probe span (an
 * `aria-hidden` child with left/top in px or %) reports where that transform puts its point on screen.
 */
function layOut(turnDeg: number, scale: number) {
  const rad = (turnDeg * Math.PI) / 180;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const unit = (value: string, full: number) => (value.endsWith("%") ? (parseFloat(value) / 100) * full : parseFloat(value) || 0);
    const x = unit(this.style.left, BOX.w) * scale;
    const y = unit(this.style.top, BOX.h) * scale;
    const left = 300 + x * Math.cos(rad) - y * Math.sin(rad);
    const top = 300 + x * Math.sin(rad) + y * Math.cos(rad);
    return { left, top, right: left, bottom: top, width: 0, height: 0, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

function box(position = "relative"): HTMLElement {
  const node = document.createElement("div");
  node.style.position = position;
  document.body.appendChild(node);
  return node;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("screenSize", () => {
  it("reads the box's layout size times the scale on its way up", () => {
    layOut(0, 1.5);
    const size = screenSize(box());
    expect(size?.w).toBeCloseTo(150, 5);
    expect(size?.h).toBeCloseTo(300, 5);
  });

  it("gives the same width and height for a box turned a quarter", () => {
    layOut(0, 1.5);
    const upright = screenSize(box());
    layOut(90, 1.5);
    const turned = screenSize(box());
    expect(turned?.w).toBeCloseTo(upright!.w, 5);
    expect(turned?.h).toBeCloseTo(upright!.h, 5);
  });

  it("removes every probe it adds, also for a pose read", () => {
    layOut(0, 1);
    const node = box();
    screenSize(node);
    screenPose(node);
    expect(node.childElementCount).toBe(0);
  });

  it("removes the probes when reading a position throws", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => {
      throw new Error("detached");
    });
    const node = box();
    expect(() => screenSize(node)).toThrow("detached");
    expect(node.childElementCount).toBe(0);
  });

  it("is null for a box that is not positioned", () => {
    layOut(0, 1);
    expect(screenSize(box("static"))).toBeNull();
  });
});
