// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DURATION,
  EASE_DRAWER,
  EASE_IN_OUT,
  EASE_OUT,
  flip,
  measureFlip,
  playFlip,
  prefersReducedMotion,
  usePresence,
  usePrefersReducedMotion,
} from "@/lib/motion";

type Listener = () => void;

/** A controllable prefers-reduced-motion matchMedia. */
function mockReducedMotion(initial: boolean) {
  const listeners = new Set<Listener>();
  const state = { matches: initial };
  const query = {
    get matches() {
      return state.matches;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  };
  window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
  return {
    set(value: boolean) {
      state.matches = value;
      listeners.forEach((fn) => fn());
    },
    listeners,
  };
}

const realMatchMedia = window.matchMedia;
const realAnimate = Element.prototype.animate;

afterEach(() => {
  window.matchMedia = realMatchMedia;
  Element.prototype.animate = realAnimate;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("tokens", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
  const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1].trim();

  it("mirrors the curves in globals.css", () => {
    expect(token("ease-out")).toBe(EASE_OUT);
    expect(token("ease-in-out")).toBe(EASE_IN_OUT);
    expect(token("ease-drawer")).toBe(EASE_DRAWER);
  });

  it("mirrors the durations JS needs", () => {
    expect(token("d-page-in")).toBe(`${DURATION.pageIn}ms`);
    expect(token("d-flip")).toBe(`${DURATION.flip}ms`);
    expect(token("d-rm")).toBe(`${DURATION.reduced}ms`);
    expect(token("d-modal-out")).toBe(`${DURATION.modalOut}ms`);
    expect(token("d-pop-out")).toBe(`${DURATION.popOut}ms`);
    expect(token("d-drawer-out")).toBe(`${DURATION.drawerOut}ms`);
    expect(token("d-toast-out")).toBe(`${DURATION.toastOut}ms`);
    expect(token("d-roll")).toBe(`${DURATION.roll}ms`);
    expect(token("d-arrive")).toBe(`${DURATION.arrive}ms`);
    expect(token("d-wash")).toBe(`${DURATION.wash}ms`);
  });
});

describe("prefersReducedMotion", () => {
  it("is false without matchMedia", () => {
    // @ts-expect-error jsdom has none; make that explicit
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reads the media query", () => {
    mockReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("usePrefersReducedMotion", () => {
  it("follows the media query and unsubscribes", () => {
    const mm = mockReducedMotion(false);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => mm.set(true));
    expect(result.current).toBe(true);
    unmount();
    expect(mm.listeners.size).toBe(0);
  });

  it("is false when matchMedia is missing", () => {
    // @ts-expect-error jsdom has none; make that explicit
    window.matchMedia = undefined;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});

describe("usePresence", () => {
  beforeEach(() => {
    mockReducedMotion(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  });

  it("starts unmounted when closed", () => {
    const { result } = renderHook(() => usePresence(false, 150));
    expect(result.current).toEqual({ mounted: false, state: "closed" });
  });

  it("mounts open in the same render and unmounts after the exit", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: false } });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: "open" });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, state: "closed" });
    act(() => void vi.advanceTimersByTime(149));
    expect(result.current.mounted).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ mounted: false, state: "closed" });
  });

  it("opening again mid-exit cancels the unmount", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => void vi.advanceTimersByTime(100));
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: "open" });
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current).toEqual({ mounted: true, state: "open" });
    // and a later close still exits normally
    rerender({ open: false });
    act(() => void vi.advanceTimersByTime(150));
    expect(result.current.mounted).toBe(false);
  });

  it("with reduced motion sets no timer and unmounts on the next frame", () => {
    mockReducedMotion(true);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: true } });
    setTimeoutSpy.mockClear();
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, state: "closed" });
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersToNextFrame());
    expect(result.current.mounted).toBe(false);
  });

  it("clears its timer on unmount", () => {
    const { rerender, unmount } = renderHook(({ open }) => usePresence(open, 150), { initialProps: { open: true } });
    rerender({ open: false });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("flip", () => {
  type FakeAnimation = { cancel: ReturnType<typeof vi.fn>; onfinish: null | (() => void); oncancel: null | (() => void) };
  let animations: Array<{ el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; anim: FakeAnimation }>;

  /** An element whose rect we control. `rect.top` stands in for layout. */
  function box(top: number, left = 0) {
    const el = document.createElement("div");
    const rect = { top, left };
    el.getBoundingClientRect = () => ({ top: rect.top, left: rect.left, right: 0, bottom: 0, width: 0, height: 0, x: rect.left, y: rect.top, toJSON() {} }) as DOMRect;
    return { el, rect };
  }

  beforeEach(() => {
    mockReducedMotion(false);
    animations = [];
    Element.prototype.animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const anim: FakeAnimation = { cancel: vi.fn(), onfinish: null, oncancel: null };
      animations.push({ el: this, keyframes, options, anim });
      return anim as unknown as Animation;
    }) as unknown as typeof Element.prototype.animate;
  });

  it("animates a moved element from its old place with a transform only", () => {
    const a = box(0);
    const b = box(50);
    flip([a.el, b.el], () => {
      a.rect.top = 50;
      b.rect.top = 0;
    });
    expect(animations).toHaveLength(2);
    expect(animations[0].keyframes).toEqual([{ transform: "translate(0px, -50px)" }, { transform: "none" }]);
    expect(animations[1].keyframes).toEqual([{ transform: "translate(0px, 50px)" }, { transform: "none" }]);
    expect(animations[0].options).toMatchObject({ duration: DURATION.flip, easing: EASE_IN_OUT });
  });

  it("skips elements that did not move", () => {
    const a = box(10, 4);
    flip([a.el], () => {});
    expect(animations).toHaveLength(0);
  });

  it("reads every rect before mutating and writes only after", () => {
    const order: string[] = [];
    const a = box(0);
    const orig = a.el.getBoundingClientRect;
    a.el.getBoundingClientRect = () => {
      order.push("read");
      return orig();
    };
    (Element.prototype.animate as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(function (this: Element) {
      order.push("write");
      return { cancel() {}, onfinish: null, oncancel: null } as unknown as Animation;
    });
    flip([a.el], () => {
      order.push("mutate");
      a.rect.top = 20;
    });
    expect(order).toEqual(["read", "mutate", "read", "write"]);
  });

  it("cancels a running flip on the same element before the next one", () => {
    const a = box(0);
    flip([a.el], () => (a.rect.top = 30));
    const first = animations[0].anim;
    flip([a.el], () => (a.rect.top = 60));
    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(animations).toHaveLength(2);
  });

  it("forgets a flip that finished, so it is not cancelled later", () => {
    const a = box(0);
    flip([a.el], () => (a.rect.top = 30));
    const first = animations[0].anim;
    first.onfinish?.();
    flip([a.el], () => (a.rect.top = 60));
    expect(first.cancel).not.toHaveBeenCalled();
  });

  it("does nothing under reduced motion, but still runs the change", () => {
    mockReducedMotion(true);
    const a = box(0);
    const mutate = vi.fn(() => (a.rect.top = 40));
    flip([a.el], mutate);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(animations).toHaveLength(0);
  });

  it("does nothing without Element.animate", () => {
    // @ts-expect-error simulate an engine without WAAPI
    Element.prototype.animate = undefined;
    const a = box(0);
    expect(() => flip([a.el], () => (a.rect.top = 40))).not.toThrow();
  });

  it("measureFlip and playFlip work across a React-style gap", () => {
    const a = box(0);
    const snapshot = measureFlip([a.el]);
    a.rect.top = 25;
    playFlip(snapshot, { duration: 100, easing: "linear" });
    expect(animations[0].keyframes[0]).toEqual({ transform: "translate(0px, -25px)" });
    expect(animations[0].options).toMatchObject({ duration: 100, easing: "linear" });
  });
});
