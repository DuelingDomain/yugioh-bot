// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePageEnter } from "@/components/layout/use-page-enter";
import { DURATION, EASE_OUT } from "@/lib/motion";

type Call = { keyframes: Keyframe[]; options: KeyframeAnimationOptions };
let calls: Call[];
let cancels: ReturnType<typeof vi.fn>[];
let playState: "running" | "finished";
const realAnimate = Element.prototype.animate;
const realMatchMedia = window.matchMedia;

function reduced(value: boolean) {
  window.matchMedia = vi.fn(() => ({ matches: value, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

function setup(initial = "/dashboard") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const hook = renderHook(({ path }) => usePageEnter({ current: el }, path), { initialProps: { path: initial } });
  return { el, ...hook };
}

beforeEach(() => {
  calls = [];
  cancels = [];
  playState = "finished";
  reduced(false);
  window.history.replaceState({}, "", "/dashboard");
  Element.prototype.animate = function (keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    calls.push({ keyframes, options });
    const cancel = vi.fn();
    cancels.push(cancel);
    return { cancel, playState } as unknown as Animation;
  } as unknown as typeof Element.prototype.animate;
});

afterEach(() => {
  Element.prototype.animate = realAnimate;
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

describe("usePageEnter", () => {
  it("does not animate the first render", () => {
    setup();
    expect(calls).toHaveLength(0);
  });

  it("fades in with a 6px rise on a pathname change", () => {
    const { rerender } = setup();
    rerender({ path: "/tournaments" });
    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes).toEqual([
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
    expect(calls[0].options).toMatchObject({ duration: DURATION.pageIn, easing: EASE_OUT, fill: "backwards" });
  });

  it("does nothing when the pathname is unchanged (a ?tab= change re-renders with the same path)", () => {
    const { rerender } = setup();
    rerender({ path: "/dashboard" });
    rerender({ path: "/dashboard" });
    expect(calls).toHaveLength(0);
  });

  it("falls 6px after the browser went back", () => {
    const { rerender } = setup();
    window.history.replaceState({}, "", "/tournaments");
    window.dispatchEvent(new PopStateEvent("popstate"));
    rerender({ path: "/tournaments" });
    expect(calls[0].keyframes[0]).toEqual({ opacity: 0, transform: "translateY(-6px)" });
    // the flag is used up: the next link click rises again
    rerender({ path: "/drafts" });
    expect(calls[1].keyframes[0]).toEqual({ opacity: 0, transform: "translateY(6px)" });
  });

  it("ignores a popstate that stays on the same pathname", () => {
    const { rerender } = setup();
    window.history.replaceState({}, "", "/dashboard?tab=standings");
    window.dispatchEvent(new PopStateEvent("popstate"));
    rerender({ path: "/drafts" });
    expect(calls[0].keyframes[0]).toEqual({ opacity: 0, transform: "translateY(6px)" });
  });

  it("with reduced motion is a short opacity fade and no movement", () => {
    reduced(true);
    const { rerender } = setup();
    rerender({ path: "/tournaments" });
    expect(calls[0].keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(calls[0].options.duration).toBe(DURATION.reduced);
  });

  it("cancels the animation still running and starts from the opacity it had reached", () => {
    playState = "running";
    const { el, rerender } = setup();
    rerender({ path: "/tournaments" });
    el.style.opacity = "0.5";
    rerender({ path: "/drafts" });
    expect(cancels[0]).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].keyframes[0]).toMatchObject({ opacity: 0.5 });
  });

  it("removes its popstate listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = setup();
    unmount();
    expect(remove).toHaveBeenCalledWith("popstate", expect.any(Function), true);
  });

  it("does not throw without Element.animate", () => {
    // @ts-expect-error simulate an engine without WAAPI
    Element.prototype.animate = undefined;
    const { rerender } = setup();
    expect(() => rerender({ path: "/tournaments" })).not.toThrow();
  });
});
