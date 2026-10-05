// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { boxAt, boxOf, boxesDiffer, flipDelta, flipTransform, playFlip, textFadeAt, turningKeyframes, visualBox, type FlipTrack } from "@/components/duel/table/grid-flip";
import { TableShell } from "@/components/duel/table/table-shell";

describe("flip boxes", () => {
  const from = boxOf({ x: 100, y: 50, width: 200, height: 100 });
  const to = boxOf({ x: 300, y: 250, width: 400, height: 150 });

  it("makes a transform that puts the new box on the old one, and none when nothing moved", () => {
    const delta = flipDelta(from, to);
    expect(delta).toEqual({ dx: -300, dy: -225, sx: 0.5, sy: 100 / 150 });
    expect(boxesDiffer(from, to)).toBe(true);
    expect(boxesDiffer(to, { ...to, cx: to.cx + 0.2 })).toBe(false);
    expect(flipTransform(delta, 0)).toBe("translate(-300.00px, -225.00px) scale(0.5000, 0.6667)");
  });

  it("turns the translate of a box that is turned 180 degrees", () => {
    expect(flipTransform({ dx: 10, dy: -4, sx: 1, sy: 1 }, 180)).toBe("translate(-10.00px, 4.00px) scale(1.0000, 1.0000)");
  });

  it("shows the old box at progress 0, the new one at 1, and a box between them in the middle", () => {
    const delta = flipDelta(from, to);
    expect(boxAt(to, delta, 0)).toEqual(from);
    expect(boxAt(to, delta, 1)).toEqual(to);
    const mid = boxAt(to, delta, 0.5);
    expect(mid.cx).toBeCloseTo((from.cx + to.cx) / 2, 6);
    expect(mid.w).toBeCloseTo((from.w + to.w) / 2, 6);
  });

  it("reads where a running move has got to, so a second move starts from the screen, not from the old layout", () => {
    const delta = flipDelta(from, to);
    const track: FlipTrack = { box: to, delta, anim: { effect: { getComputedTiming: () => ({ progress: 0.25 }) } } as unknown as Animation, text: [] };
    expect(visualBox(track)).toEqual(boxAt(to, delta, 0.25));
    expect(visualBox({ ...track, anim: null })).toEqual(to);
  });
});

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

function Shell({ reduced }: { reduced: boolean }) {
  const controller = useFixtureController(FFA4_FIXTURES.states.main, { reducedMotion: reduced });
  return <TableShell controller={controller} />;
}

type Call = { el: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void };
/**
 * A WAAPI stand-in that plays the keyframes: the first one is on the element while the move runs, `finish()` puts the last
 * one there and fires the finish listeners (the jsdom default never runs a move, so "no transform at rest" proved nothing).
 */
function stubAnimate(): Call[] {
  const calls: Call[] = [];
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const el = this;
    const listeners: Array<() => void> = [];
    const isMove = frames.some((frame) => frame.transform != null);
    if (isMove) el.style.transform = String(frames[0].transform);
    const finish = () => {
      if (isMove) el.style.transform = String(frames[frames.length - 1].transform) === "none" ? "" : String(frames[frames.length - 1].transform);
      for (const listener of listeners) listener();
    };
    calls.push({ el, frames, options, finish });
    return { cancel: vi.fn(), addEventListener: (_: string, listener: () => void) => listeners.push(listener), effect: null };
  };
  return calls;
}

describe("GridStage FLIP", () => {
  it("does not animate the first layout, then moves every field and life box that changed on a focus change", () => {
    const calls = stubAnimate();
    const { container } = render(<Shell reduced={false} />);
    expect(calls).toHaveLength(0);
    act(() => void fireEvent.keyDown(window, { key: "4" }));
    const fields = calls.filter((call) => call.el.hasAttribute("data-seat-slot"));
    const panels = calls.filter((call) => call.el.hasAttribute("data-grid-lp"));
    expect(fields.length).toBe(4);
    expect(panels.length).toBe(4);
    for (const call of [...fields, ...panels]) {
      expect(call.options.duration).toBe(500);
      expect(call.options.easing).toBe("cubic-bezier(.2,.8,.2,1)");
    }
    const move = fields[0].frames;
    expect(move[move.length - 1]).toEqual({ transform: "none" });
    expect(String(move[0].transform)).toMatch(/^translate\(.*\) scale\(/);
    // the life panel text fades while the panel moves
    expect(calls.some((call) => call.el.hasAttribute("data-holo-text") && call.frames.some((frame) => frame.offset === 0.7))).toBe(true);
    // while the move runs the boxes show the old place, and when it ends they carry no transform
    const boxes = [...fields, ...panels].map((call) => call.el);
    for (const node of boxes) expect(node.style.transform).toMatch(/^translate\(/);
    act(() => calls.forEach((call) => call.finish()));
    for (const node of container.querySelectorAll<HTMLElement>("[data-seat-slot], [data-grid-lp]")) expect(node.style.transform).toBe("");
  });

  it("jumps with no animation when reduced motion is on, and when nothing changed", () => {
    const calls = stubAnimate();
    render(<Shell reduced />);
    act(() => void fireEvent.keyDown(window, { key: "4" }));
    expect(calls).toHaveLength(0);
  });

  it("starts the text fade of a move that stops a move from the opacity on screen, not from 1", () => {
    expect(textFadeAt(0)).toBe(1);
    expect(textFadeAt(0.15)).toBe(0);
    expect(textFadeAt(0.4)).toBe(0);
    expect(textFadeAt(0.85)).toBeCloseTo(0.5, 6);
    expect(textFadeAt(1)).toBe(1);
    const el = document.createElement("div");
    const text = document.createElement("b");
    text.setAttribute("data-holo-text", "true");
    el.appendChild(text);
    const calls = stubAnimate();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, frames: Keyframe[]) {
      calls.push({ el: this, frames, options: {}, finish: () => {} });
      return { cancel: vi.fn(), addEventListener: vi.fn(), effect: { getComputedTiming: () => ({ progress: 0.3 }) } };
    };
    const first = playFlip(el, { box: boxOf({ x: 0, y: 0, width: 100, height: 40 }), delta: null, anim: null, text: [] }, boxOf({ x: 80, y: 0, width: 200, height: 80 }), true, { turn: 0, fadeText: true });
    const fade = (call: Call) => call.frames.map((frame) => frame.opacity);
    expect(fade(calls.filter((call) => call.el === text)[0])[0]).toBe(1);
    // the first fade is 30% in: opacity 0. The second move must start at 0, never at 1.
    playFlip(el, first, boxOf({ x: 0, y: 40, width: 100, height: 40 }), true, { turn: 0, fadeText: true });
    expect(fade(calls.filter((call) => call.el === text)[1])[0]).toBe(0);
  });

  it("keeps playFlip a no-op without the Web Animations API", () => {
    const el = document.createElement("div");
    const track = playFlip(el, { box: boxOf({ x: 0, y: 0, width: 10, height: 10 }), delta: null, anim: null, text: [] }, boxOf({ x: 50, y: 0, width: 10, height: 10 }), true, { turn: 0, fadeText: false });
    expect(track.anim).toBeNull();
    expect(track.box.cx).toBe(55);
  });

  it("turns a field from 0 to 180 on its way, even when its box does not change, with the individual transform properties", () => {
    const el = document.createElement("div");
    const calls = stubAnimate();
    const box = boxOf({ x: 0, y: 0, width: 100, height: 40 });
    const track = playFlip(el, { box, turn: 0, delta: null, anim: null, text: [] }, box, true, { turn: 180, fadeText: false });
    expect(track.turn).toBe(180);
    expect(calls).toHaveLength(1);
    expect(calls[0].frames).toEqual(turningKeyframes({ dx: 0, dy: 0, sx: 1, sy: 1 }, 0, 180));
    expect(calls[0].frames[0]).toMatchObject({ rotate: "0deg", translate: "0.00px 0.00px", scale: "1.0000 1.0000" });
    expect(calls[0].frames[1]).toMatchObject({ rotate: "180deg", translate: "0px 0px", scale: "1 1" });
    expect(calls[0].frames.some((frame) => frame.transform != null)).toBe(false);
    // The same box at the same turn does not move.
    expect(playFlip(el, track, box, true, { turn: 180, fadeText: false }).anim).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
