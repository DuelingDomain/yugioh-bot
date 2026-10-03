// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Holo, type HoloTarget } from "../../../src/components/draft/room/holo";
import * as motion from "../../../src/components/draft/room/motion";

const card: HoloTarget["card"] = {
  id: 60, passcode: 100060, name: "Lower card", type: "Effect Monster", frameType: "effect", attribute: "DARK",
  level: 4, atk: 1000, def: 1000, effectText: "Does a thing.",
  imageUrl: "/c/60.jpg", imageUrlSmall: "/c/60s.jpg",
};

let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  motion.setCurrentMotion("full");
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  motion.setCurrentMotion("full");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}

function renderHolo(width = 1100, partial = false) {
  const stage = document.createElement("section");
  stage.className = "stage";
  stage.scrollTop = 400;
  stage.scrollLeft = 30;
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 40, width, 800));
  const el = document.createElement("div");
  const face = document.createElement("span");
  face.className = "face";
  el.appendChild(face);
  const rect = vi.spyOn(face, "getBoundingClientRect").mockImplementation(() =>
    new DOMRect(320 - stage.scrollLeft, 1040 - stage.scrollTop, 100, 100 * 86 / 59),
  );
  const host = document.createElement("div");
  stage.append(el, host);
  document.body.appendChild(stage);
  const target: HoloTarget = { card, el, partial };
  const view = render(<Holo target={target} stage={stage} />, { container: host });
  const holo = host.querySelector<HTMLElement>(".holo")!;
  return { ...view, stage, rect, target, holo };
}

describe("Holo in a scrolling stage", () => {
  it.each([1100, 1440].flatMap((width) => [false, true].map((partial) => ({ width, partial }))))(
    "includes stage scroll offsets at $width wide with partial $partial",
    ({ width, partial }) => {
      const { holo } = renderHolo(width, partial);
      expect(holo).toHaveAttribute("data-on");
      // 200px hologram over a 100px card at content (300, 1000).
      const expectedTop = partial ? 735.2542372881356 : 726.5084745762712;
      const [x, y] = holo.style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(x).toBeCloseTo(250);
      expect(y).toBeCloseTo(expectedTop);
    },
  );

  it.each(["full", "off"] as const)("follows scrolling once per frame using only transform with motion %s", (level) => {
    motion.setCurrentMotion(level);
    const animate = vi.spyOn(motion, "animate");
    const { stage, rect, holo } = renderHolo();
    const initialStyle = holo.style.cssText;
    const initialTransform = holo.style.transform;
    const initialReads = rect.mock.calls.length;
    const initialAnimations = animate.mock.calls.length;
    if (level === "off") expect(initialAnimations).toBe(0);

    // Once the card is high in the viewport, the hologram must follow its
    // viewport-top clamp instead of disappearing above the scrolling stage.
    stage.scrollTop = 800;
    fireEvent.scroll(stage);
    stage.scrollTop = 850;
    fireEvent.scroll(stage);
    expect(holo.style.transform).toBe(initialTransform);
    expect(rect).toHaveBeenCalledTimes(initialReads);
    flushFrame();
    expect(holo.style.transform).toBe("translate(250px, 860px)");
    expect(rect).toHaveBeenCalledTimes(initialReads + 1);
    expect(holo.style.cssText.replace(holo.style.transform, initialTransform)).toBe(initialStyle);
    expect(animate).toHaveBeenCalledTimes(initialAnimations);
  });

  it("stops following and cancels a pending frame when the target is cleared", () => {
    motion.setCurrentMotion("off");
    const { stage, holo, rerender } = renderHolo();
    const transform = holo.style.transform;
    stage.scrollTop = 850;
    fireEvent.scroll(stage);
    expect(frames.size).toBe(1);
    rerender(<Holo target={null} stage={stage} />);
    expect(frames.size).toBe(0);
    flushFrame();
    expect(holo).not.toHaveAttribute("data-on");
    expect(holo.style.transform).toBe(transform);
    fireEvent.scroll(stage);
    flushFrame();
    expect(holo.style.transform).toBe(transform);
  });

  it("uses only transform and opacity when swapping holograms", () => {
    const { stage, target, rerender } = renderHolo();
    const animate = vi.spyOn(motion, "animate");
    rerender(<Holo target={{ ...target, card: { ...card, id: 61 } }} stage={stage} />);
    expect(animate).toHaveBeenCalledTimes(1);
    for (const frame of animate.mock.calls[0][1]) {
      expect(Object.keys(frame).every((key) => key === "transform" || key === "opacity")).toBe(true);
    }
  });
});
