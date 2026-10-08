// @vitest-environment jsdom
import React, { useReducer } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SeatField } from "@/components/duel/field";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { initialRoofCamera, roofReducer } from "@/components/duel/tag/roof-camera";
import { TagStage } from "@/components/duel/tag/tag-stage";
import { tableLayout } from "@/components/duel/table/geometry";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";

/** A stand-in for a Web Animation: it records what the stage asks for and lets the test end it. */
interface FakeAnim {
  node: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancelled: boolean;
  cancel: () => void;
  onfinish: (() => void) | null;
}

let anims: FakeAnim[] = [];
let observed: (() => void) | null = null;
let now = 1000;
const size = { w: 1000, h: 800 };

beforeEach(() => {
  anims = [];
  observed = null;
  now = 1000;
  size.w = 1000;
  size.h = 800;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => size.w });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => size.h });
  Element.prototype.animate = function (this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
    const anim: FakeAnim = {
      node: this,
      frames: frames as Keyframe[],
      options: (options ?? {}) as KeyframeAnimationOptions,
      cancelled: false,
      cancel() {
        anim.cancelled = true;
      },
      onfinish: null,
    };
    anims.push(anim);
    return anim as unknown as Animation;
  } as typeof Element.prototype.animate;
  class FakeObserver {
    constructor(callback: () => void) {
      observed = callback;
    }
    observe() {}
    disconnect() {
      observed = null;
    }
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
});

function Stage() {
  const state = TAG_FIXTURES.states.main;
  const controller = useFixtureController(state, { reducedMotion: false });
  const layout = tableLayout("tag", controller.engine, controller.viewerSeat);
  const [camera, dispatch] = useReducer(roofReducer, undefined, () => initialRoofCamera({ anchorSeat: layout.anchorSeat }));
  return (
    <div style={{ width: 1000, height: 800 }}>
      <TagStage controller={controller} layout={layout} camera={camera} dispatchCamera={dispatch} renderSeatField={(props) => <SeatField {...props} />} teamNames={TAG_TEAM_NAMES} />
    </div>
  );
}

/** The animations of the world (its keyframes are transforms of the roof camera). */
const worldAnims = () => anims.filter((anim) => anim.frames.some((frame) => typeof frame.transform === "string" && String(frame.transform).includes("rotateX")));
const live = () => worldAnims().filter((anim) => !anim.cancelled);
const worldNode = () => worldAnims()[0]?.node as HTMLElement | undefined;

describe("Tag camera move with the Web Animations API", () => {
  it("runs one animation of the world per move, with will-change only while it runs, and ends with apply()", () => {
    const { container } = render(<Stage />);
    const before = worldAnims().length;
    fireEvent.click(container.querySelector('[data-field-focus="1"]')!);
    expect(worldAnims().length).toBe(before + 1);
    const run = live()[0]!;
    expect(run.options.easing).toBe("linear");
    expect(run.frames.length).toBeGreaterThan(8);
    const world = run.node as HTMLElement;
    expect(world.style.willChange).toBe("transform");
    // The world already holds the pose it ends on (the animation only runs the way there).
    const endTransform = String(run.frames[run.frames.length - 1]!.transform);
    expect(world.style.transform).toBe(endTransform);
    act(() => run.onfinish?.());
    expect(world.style.willChange).toBe("");
    expect(world.style.transform).toBe(endTransform);
    expect(run.cancelled).toBe(true);
  });

  it("a move cut in half starts from the pose on screen, cancels the old one, and plays one animation", () => {
    const { container } = render(<Stage />);
    fireEvent.click(container.querySelector('[data-field-focus="1"]')!);
    const first = live()[0]!;
    const startFrame = String(first.frames[0]!.transform);
    const endFrame = String(first.frames[first.frames.length - 1]!.transform);
    now += (first.options.duration as number) / 2;
    fireEvent.click(container.querySelector('[data-camera-seat-button="2"]')!);
    expect(first.cancelled).toBe(true);
    expect(live()).toHaveLength(1);
    const second = live()[0]!;
    const cutFrame = String(second.frames[0]!.transform);
    expect(cutFrame).not.toBe(startFrame);
    expect(cutFrame).not.toBe(endFrame);
    expect((second.node as HTMLElement).style.willChange).toBe("transform");
  });

  it("a resize during a move restarts it from the pose on screen with the new fit (one animation, no double jump)", () => {
    const { container } = render(<Stage />);
    fireEvent.click(container.querySelector('[data-field-focus="1"]')!);
    const first = live()[0]!;
    now += 120;
    size.w = 700;
    size.h = 600;
    act(() => observed?.());
    expect(first.cancelled).toBe(true);
    expect(live()).toHaveLength(1);
    const next = live()[0]!;
    expect(String(next.frames[0]!.transform)).not.toBe(String(first.frames[0]!.transform));
    expect(next.options.duration).toBeLessThan(first.options.duration as number);
    // The same size again changes nothing.
    const count = worldAnims().length;
    act(() => observed?.());
    expect(worldAnims().length).toBe(count);
  });

  it("a change of the free box in a close-up eases to the new fit instead of jumping", () => {
    const { container } = render(<Stage />);
    fireEvent.click(container.querySelector('[data-field-focus="1"]')!);
    act(() => live()[0]!.onfinish?.());
    expect(live()).toHaveLength(0);
    const world = worldNode()!;
    const before = world.style.transform;
    const count = worldAnims().length;
    size.h = 640;
    act(() => observed?.());
    expect(worldAnims().length).toBe(count + 1);
    const ease = live()[0]!;
    expect(ease.options.duration).toBeLessThanOrEqual(300);
    // It starts on the pose and the fit that were on screen, and ends on the new fit (which the world already holds).
    expect(String(ease.frames[0]!.transform)).toBe(before);
    expect(String(ease.frames[ease.frames.length - 1]!.transform)).toBe(world.style.transform);
    expect(world.style.transform).not.toBe(before);
  });

  it("the overview does not animate a resize (the world keeps its pose, only the fit changes)", () => {
    render(<Stage />);
    const count = worldAnims().length;
    size.w = 700;
    act(() => observed?.());
    expect(worldAnims().length).toBe(count);
  });

  it("cancels every running animation when the stage unmounts", () => {
    const { container, unmount } = render(<Stage />);
    fireEvent.click(container.querySelector('[data-field-focus="1"]')!);
    const running = anims.filter((anim) => !anim.cancelled);
    expect(running.length).toBeGreaterThan(0);
    unmount();
    expect(anims.every((anim) => anim.cancelled)).toBe(true);
  });
});
