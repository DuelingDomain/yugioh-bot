// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANIMATION_SPEED_KEY, loadAnimationSpeed, normalizeAnimationSpeed, saveAnimationSpeed, setAnimationSpeed } from "@/components/duel/animation-speed";
import { createDuelFxClock, duelFxClock } from "@/components/duel/fx-clock";
import { waitForReveal } from "@/components/duel/prompt-reveal";
import { DuelAnimationSpeedControl, useDuelAnimationSpeed } from "@/components/duel/animation-speed-control";

beforeEach(() => {
  window.localStorage.clear();
  setAnimationSpeed(1);
  duelFxClock.setReducedMotion(false);
  duelFxClock.resetReviewTimeline();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("local animation speed", () => {
  it("defaults safely and clamps and rounds finite values", () => {
    expect(loadAnimationSpeed()).toBe(1);
    expect(normalizeAnimationSpeed(0.1)).toBe(0.5);
    expect(normalizeAnimationSpeed(8)).toBe(2);
    expect(normalizeAnimationSpeed(1.234)).toBe(1.25);
    for (const invalid of [NaN, Infinity, "2", null]) expect(normalizeAnimationSpeed(invalid)).toBe(1);
  });
  it("persists across reloads and handles corrupt or blocked storage", () => {
    saveAnimationSpeed(1.5);
    expect(loadAnimationSpeed()).toBe(1.5);
    window.localStorage.setItem(ANIMATION_SPEED_KEY, "garbage");
    expect(loadAnimationSpeed()).toBe(1);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadAnimationSpeed()).toBe(1);
    expect(() => saveAnimationSpeed(2)).not.toThrow();
  });
  it("keeps the in-memory preference when another control mounts with storage blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    setAnimationSpeed(1.5);
    render(<DuelAnimationSpeedControl />);
    expect(screen.getByRole("slider", { name: /Animation speed/ })).toHaveValue("1.5");
  });
  it("exposes a labelled stepped slider, saves locally, and resets", () => {
    render(<DuelAnimationSpeedControl />);
    const slider = screen.getByRole("slider", { name: /Animation speed/ });
    expect(slider).toHaveAttribute("min", "0.5");
    expect(slider).toHaveAttribute("max", "2");
    expect(slider).toHaveAttribute("step", "0.05");
    fireEvent.change(slider, { target: { value: "1.5" } });
    expect(screen.getByText("1.50x")).toBeInTheDocument();
    expect(loadAnimationSpeed()).toBe(1.5);
    fireEvent.click(screen.getByRole("button", { name: /Reset.*1x/ }));
    expect(slider).toHaveValue("1");
    expect(loadAnimationSpeed()).toBe(1);
  });
});

describe("scoped FX clock", () => {
  it.each([0.5, 1, 2])("scales timers at %sx while keeping activate → destroy → GY sequential and real clocks intact", (speed) => {
    vi.useFakeTimers();
    let real = 0;
    const fx = createDuelFxClock(() => speed, () => real);
    const order: string[] = [];
    const date = Date.now();
    fx.setTimeout(() => {
      order.push("activate");
      fx.setTimeout(() => {
        order.push("destroy");
        fx.setTimeout(() => order.push("GY"), 600);
      }, 400);
    }, 800);
    for (const ms of [800, 400, 600]) {
      real += ms / speed;
      act(() => vi.advanceTimersByTime(ms / speed));
    }
    expect(order).toEqual(["activate", "destroy", "GY"]);
    expect(fx.now()).toBeCloseTo(1800);
    expect(Date.now() - date).toBeCloseTo(1800 / speed);
  });
  it("defers a speed change until running effects finish, without a clock jump", () => {
    vi.useFakeTimers();
    let real = 0;
    let speed = 1;
    const fx = createDuelFxClock(() => speed, () => real);
    const finished = vi.fn();
    fx.setTimeout(finished, 1000);
    real = 300; vi.advanceTimersByTime(300); speed = 2;
    expect(fx.factor()).toBe(1);
    real = 999; vi.advanceTimersByTime(699);
    expect(finished).not.toHaveBeenCalled();
    real = 1000; vi.advanceTimersByTime(1);
    expect(finished).toHaveBeenCalledOnce();
    expect(fx.factor()).toBe(2);
    expect(fx.now()).toBe(1000);
    fx.setTimeout(finished, 1000);
    real = 1500; vi.advanceTimersByTime(500);
    expect(finished).toHaveBeenCalledTimes(2);
    expect(fx.now()).toBe(2000);
  });
  it("keeps reduced motion at its own pace regardless of the preference", () => {
    const fx = createDuelFxClock(() => 0.5, () => 0);
    fx.setReducedMotion(true);
    expect(fx.factor()).toBe(1);
    expect(fx.realMs(150)).toBe(150);
  });
  it("keeps an active reduced fade at 1x when the slider changes", () => {
    let speed = 0.5;
    const fx = createDuelFxClock(() => speed, () => 0);
    fx.setReducedMotion(true);
    fx.retain(150);
    speed = 2;
    expect(fx.factor()).toBe(1);
    expect(fx.realMs(150)).toBe(150);
  });
  it("captures DOM animation playback and frame timestamps at the same speed", () => {
    let real = 0;
    let speed = 2;
    const fx = createDuelFxClock(() => speed, () => real);
    const anim = { playbackRate: 1, finished: new Promise(() => {}) } as unknown as Animation;
    const el = document.createElement("div");
    el.animate = vi.fn(() => anim);
    fx.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 1000 });
    expect(anim.playbackRate).toBe(2);
    speed = 0.5;
    real = 250;
    expect(fx.now()).toBe(500);
    expect(fx.factor()).toBe(2);
    expect(anim.playbackRate).toBe(2);
    real = 500;
    expect(fx.factor()).toBe(0.5);
    expect(fx.now()).toBe(1000);
  });
  it("keeps frame timestamps monotonic when callback work follows a speed change", () => {
    let real = 1000;
    let speed = 1;
    const fx = createDuelFxClock(() => speed, () => real);
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => { callbacks.push(fn); return callbacks.length; });
    const stamps: number[] = [];
    fx.requestAnimationFrame((stamp) => stamps.push(stamp)); callbacks[0](1000);
    real = 1040; speed = 2;
    fx.requestAnimationFrame((stamp) => stamps.push(stamp)); callbacks[1](1016);
    expect(stamps).toEqual([1000, 1016]);
    expect(fx.now()).toBe(1040);
  });
  it("clears a gate safety timer when animation completion wins the race", async () => {
    vi.useFakeTimers();
    await waitForReveal({ source: null, reducedMotion: false, pendingAnimations: () => [{ finished: Promise.resolve(), playState: "running" }],
      timing: { beatMs: 0, settleMs: 0, capMs: 8000 } });
    expect(vi.getTimerCount()).toBe(0);
    act(() => setAnimationSpeed(2));
    expect(duelFxClock.factor()).toBe(2);
  });
  it("rates CSS effects on a board mounted after loading, without touching effects outside the room", () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    const css = { playbackRate: 1, effect: { getComputedTiming: () => ({ endTime: 500 }) } };
    class FakeCSSAnimation {}
    Object.setPrototypeOf(css, FakeCSSAnimation.prototype);
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    render(<Scope />);
    act(() => setAnimationSpeed(2));
    const board = document.createElement("div"); board.setAttribute("data-duel-fx-speed-root", "");
    const target = document.createElement("div"); board.append(target); document.body.append(board);
    target.getAnimations = () => [css as unknown as Animation];
    fireEvent(target, new Event("animationstart", { bubbles: true }));
    expect(css.playbackRate).toBe(2);
    board.remove();
    css.playbackRate = 1;
    document.body.append(target);
    fireEvent(target, new Event("animationstart", { bubbles: true }));
    expect(css.playbackRate).toBe(1);
    target.remove(); vi.unstubAllGlobals();
  });
  it.each(["button", "handCard", "fieldWash"])("keeps %s UI transitions at real speed without a lease", async (kind) => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    class FakeCSSTransition {}
    vi.stubGlobal("CSSTransition", FakeCSSTransition);
    const transition = Object.assign(new FakeCSSTransition(), {
      playbackRate: 1, playState: "running", finished: new Promise(() => {}),
      effect: { getComputedTiming: () => ({ endTime: 480 }) },
    });
    render(<Scope />);
    act(() => setAnimationSpeed(0.5));
    const board = document.createElement("div"); board.setAttribute("data-duel-fx-speed-root", "");
    const target = document.createElement(kind === "button" ? "button" : "div"); target.className = kind;
    Object.assign(transition.effect, { target }); board.append(target);
    document.getAnimations = () => [transition as unknown as Animation];
    await act(async () => { document.body.append(board); });
    fireEvent(target, new Event("transitionrun", { bubbles: true }));
    expect(transition.playbackRate).toBe(1);
    act(() => setAnimationSpeed(2));
    expect(duelFxClock.factor()).toBe(2);
    board.remove(); delete (document as { getAnimations?: unknown }).getAnimations; vi.unstubAllGlobals();
  });
  it("updates continuous CSS pulses after captured finite effects finish", async () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    class FakeCSSAnimation {}
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    let finish!: () => void;
    const finite = Object.assign(new FakeCSSAnimation(), { playbackRate: 1, playState: "running", finished: new Promise<void>((resolve) => { finish = resolve; }), effect: { target: undefined as Element | undefined, getComputedTiming: () => ({ endTime: 1000 }) } });
    const loop = Object.assign(new FakeCSSAnimation(), { playbackRate: 1, playState: "running", effect: { target: undefined as Element | undefined, getComputedTiming: () => ({ endTime: Infinity }) } });
    render(<Scope />);
    const board = document.createElement("div"); board.setAttribute("data-duel-fx-speed-root", "");
    finite.effect.target = board; loop.effect.target = board;
    document.getAnimations = () => [finite, loop] as unknown as Animation[];
    await act(async () => { document.body.append(board); });
    act(() => setAnimationSpeed(2));
    expect(finite.playbackRate).toBe(1);
    expect(loop.playbackRate).toBe(1);
    await act(async () => { finish(); });
    expect(finite.playbackRate).toBe(1);
    expect(loop.playbackRate).toBe(2);
    board.remove(); delete (document as { getAnimations?: unknown }).getAnimations; vi.unstubAllGlobals();
  });
  it("scales pending CSS delays before animationstart", async () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    class FakeCSSAnimation {}
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    render(<Scope />);
    act(() => setAnimationSpeed(2));
    const anim = Object.assign(new FakeCSSAnimation(), { playbackRate: 1, effect: { target: undefined as Element | undefined, getComputedTiming: () => ({ endTime: 850 }) } });
    const board = document.createElement("div"); board.setAttribute("data-duel-fx-speed-root", "");
    anim.effect.target = board;
    document.getAnimations = () => [anim as unknown as Animation];
    await act(async () => { document.body.append(board); });
    expect(anim.playbackRate).toBe(2);
    board.remove(); delete (document as { getAnimations?: unknown }).getAnimations; vi.unstubAllGlobals();
  });
});
