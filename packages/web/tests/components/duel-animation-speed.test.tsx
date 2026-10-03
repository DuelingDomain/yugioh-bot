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
const boards: Element[] = [];
const track = <T extends Element>(el: T): T => { boards.push(el); return el; };
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
  for (const el of boards.splice(0)) el.remove();
  delete (document as { getAnimations?: unknown }).getAnimations;
  delete (document as { timeline?: unknown }).timeline;
});

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
  it("rates CSS effects on a board mounted after loading, without touching effects outside the room", async () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    const css = { playbackRate: 1, effect: { target: undefined as Element | undefined, getComputedTiming: () => ({ endTime: 500 }) } };
    class FakeCSSAnimation {}
    Object.setPrototypeOf(css, FakeCSSAnimation.prototype);
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    render(<Scope />);
    act(() => setAnimationSpeed(2));
    const board = track(document.createElement("div")); board.setAttribute("data-duel-fx-speed-root", "");
    const target = document.createElement("div"); board.append(target); document.body.append(board);
    css.effect.target = target;
    const getAnimations = vi.fn(() => [css as unknown as Animation]);
    document.getAnimations = getAnimations;
    fireEvent(target, new Event("animationstart", { bubbles: true }));
    expect(css.playbackRate).toBe(2);
    // A start event from outside the room, while a room is mounted, must not trigger a sweep.
    const outside = track(document.createElement("div")); document.body.append(outside);
    await act(async () => {});
    getAnimations.mockClear();
    fireEvent(outside, new Event("animationstart", { bubbles: true }));
    expect(getAnimations).not.toHaveBeenCalled();
  });
  it("sweeps once per timeline frame for animationstart events and again on the next frame", () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    class FakeCSSAnimation {}
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    const board = track(document.createElement("div")); board.setAttribute("data-duel-fx-speed-root", "");
    const cards = Array.from({ length: 5 }, () => board.appendChild(document.createElement("div")));
    document.body.append(board);
    const getAnimations = vi.fn(() => [] as Animation[]);
    document.getAnimations = getAnimations;
    const timeline = { currentTime: 100 as number | null };
    Object.defineProperty(document, "timeline", { configurable: true, value: timeline });
    render(<Scope />);
    const elementSweep = vi.fn(() => [] as Animation[]);
    for (const card of cards) card.getAnimations = elementSweep;
    const start = (list: Element[]) => { for (const card of list) fireEvent(card, new Event("animationstart", { bubbles: true })); };
    getAnimations.mockClear();
    start(cards);
    expect(getAnimations).toHaveBeenCalledTimes(1);
    expect(elementSweep).not.toHaveBeenCalled();
    timeline.currentTime = 116;
    start(cards.slice(0, 1));
    expect(getAnimations).toHaveBeenCalledTimes(2);
    start(cards.slice(1));
    expect(getAnimations).toHaveBeenCalledTimes(2);
  });
  it("sweeps on every animationstart when the timeline has no current time", () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    const board = track(document.createElement("div")); board.setAttribute("data-duel-fx-speed-root", "");
    const cards = Array.from({ length: 3 }, () => board.appendChild(document.createElement("div")));
    document.body.append(board);
    const getAnimations = vi.fn(() => [] as Animation[]);
    document.getAnimations = getAnimations;
    Object.defineProperty(document, "timeline", { configurable: true, value: { currentTime: null } });
    render(<Scope />);
    getAnimations.mockClear();
    for (const card of cards) fireEvent(card, new Event("animationstart", { bubbles: true }));
    expect(getAnimations).toHaveBeenCalledTimes(3);
  });
  it("leaves an animation whose target is outside the room unchanged during a sweep", async () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    class FakeCSSAnimation {}
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    render(<Scope />);
    act(() => setAnimationSpeed(2));
    const make = (target: Element) => Object.assign(new FakeCSSAnimation(), { playbackRate: 1, effect: { target, getComputedTiming: () => ({ endTime: 700 }) } });
    const board = track(document.createElement("div")); board.setAttribute("data-duel-fx-speed-root", "");
    const outside = track(document.createElement("div"));
    const inside = make(board);
    const stray = make(outside);
    document.getAnimations = () => [stray, inside] as unknown as Animation[];
    await act(async () => { document.body.append(outside, board); });
    expect(inside.playbackRate).toBe(2);
    expect(stray.playbackRate).toBe(1);
  });
  it("sweeps after a class change on an element already inside the room", async () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    class FakeCSSAnimation {}
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    const board = track(document.createElement("div")); board.setAttribute("data-duel-fx-speed-root", "");
    const card = document.createElement("div"); board.append(card); document.body.append(board);
    document.getAnimations = () => [];
    render(<Scope />);
    act(() => setAnimationSpeed(2));
    const anim = Object.assign(new FakeCSSAnimation(), { playbackRate: 1, effect: { target: card, getComputedTiming: () => ({ endTime: 600 }) } });
    document.getAnimations = () => [anim as unknown as Animation];
    expect(anim.playbackRate).toBe(1);
    await act(async () => { card.className = "summoning"; });
    expect(anim.playbackRate).toBe(2);
  });
  it("skips the document sweep when no duel room is mounted", async () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    const getAnimations = vi.fn(() => [] as Animation[]);
    document.getAnimations = getAnimations;
    render(<Scope />);
    const chat = track(document.createElement("div"));
    await act(async () => { document.body.append(chat); });
    await act(async () => { chat.className = "toast"; });
    expect(getAnimations).not.toHaveBeenCalled();
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
    const board = track(document.createElement("div")); board.setAttribute("data-duel-fx-speed-root", "");
    const target = document.createElement(kind === "button" ? "button" : "div"); target.className = kind;
    Object.assign(transition.effect, { target }); board.append(target);
    document.getAnimations = () => [transition as unknown as Animation];
    await act(async () => { document.body.append(board); });
    fireEvent(target, new Event("transitionrun", { bubbles: true }));
    expect(transition.playbackRate).toBe(1);
    act(() => setAnimationSpeed(2));
    expect(duelFxClock.factor()).toBe(2);
  });
  it("updates continuous CSS pulses after captured finite effects finish", async () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    class FakeCSSAnimation {}
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    let finish!: () => void;
    const finite = Object.assign(new FakeCSSAnimation(), { playbackRate: 1, playState: "running", finished: new Promise<void>((resolve) => { finish = resolve; }), effect: { target: undefined as Element | undefined, getComputedTiming: () => ({ endTime: 1000 }) } });
    const loop = Object.assign(new FakeCSSAnimation(), { playbackRate: 1, playState: "running", effect: { target: undefined as Element | undefined, getComputedTiming: () => ({ endTime: Infinity }) } });
    render(<Scope />);
    const board = track(document.createElement("div")); board.setAttribute("data-duel-fx-speed-root", "");
    finite.effect.target = board; loop.effect.target = board;
    document.getAnimations = () => [finite, loop] as unknown as Animation[];
    await act(async () => { document.body.append(board); });
    act(() => setAnimationSpeed(2));
    expect(finite.playbackRate).toBe(1);
    expect(loop.playbackRate).toBe(1);
    await act(async () => { finish(); });
    expect(finite.playbackRate).toBe(1);
    expect(loop.playbackRate).toBe(2);
  });
  it("scales pending CSS delays before animationstart", async () => {
    function Scope() { useDuelAnimationSpeed(); return null; }
    class FakeCSSAnimation {}
    vi.stubGlobal("CSSAnimation", FakeCSSAnimation);
    render(<Scope />);
    act(() => setAnimationSpeed(2));
    const anim = Object.assign(new FakeCSSAnimation(), { playbackRate: 1, effect: { target: undefined as Element | undefined, getComputedTiming: () => ({ endTime: 850 }) } });
    const board = track(document.createElement("div")); board.setAttribute("data-duel-fx-speed-root", "");
    anim.effect.target = board;
    document.getAnimations = () => [anim as unknown as Animation];
    await act(async () => { document.body.append(board); });
    expect(anim.playbackRate).toBe(2);
  });
});
