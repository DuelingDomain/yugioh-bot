// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireCoinLock } from "@/components/duel/coin-toss-lock";
import { clearLpMotion, noteLpMotion } from "@/components/duel/lp-motion";
import { GATE_TIMING } from "@/components/duel/duel-timing";
import {
  CRUMBLE_GATE_CAP_MS,
  beginCrumbleWait,
  crumbleMayStart,
  crumbleWaiting,
  onCrumbleStart,
  pauseRegroup,
} from "@/components/duel/table/crumble-gate";

type Stub = { finished: Promise<unknown>; playState: string; effect: { getTiming: () => { iterations: number }; target: Element } };
const running = (target: Element): Stub => ({ finished: new Promise(() => {}), playState: "running", effect: { getTiming: () => ({ iterations: 1 }), target } });

beforeEach(() => {
  vi.useFakeTimers();
  clearLpMotion();
});
afterEach(() => vi.useRealTimers());

describe("crumbleMayStart", () => {
  it("is true when nothing plays", () => {
    expect(crumbleMayStart({ getAnimations: () => [] })).toBe(true);
  });

  it("waits for a running board animation (the attack, the damage hit), and not for the crumble of another seat", () => {
    const strike = document.createElement("div");
    const other = document.createElement("div");
    other.setAttribute("data-seat-exit", "1");
    const inside = document.createElement("span");
    other.append(inside);
    expect(crumbleMayStart({ getAnimations: () => [running(strike)] })).toBe(false);
    expect(crumbleMayStart({ getAnimations: () => [running(inside)] })).toBe(true);
    expect(crumbleMayStart({ getAnimations: () => [running(inside), running(strike)] })).toBe(false);
  });

  it("waits for an LP counter that rolls, then goes on", () => {
    noteLpMotion(1500);
    expect(crumbleMayStart({ getAnimations: () => [] })).toBe(false);
    vi.advanceTimersByTime(1499);
    expect(crumbleMayStart({ getAnimations: () => [] })).toBe(false);
    vi.advanceTimersByTime(1);
    expect(crumbleMayStart({ getAnimations: () => [] })).toBe(true);
  });

  it("waits for a coin toss", () => {
    const release = acquireCoinLock();
    expect(crumbleMayStart({ getAnimations: () => [] })).toBe(false);
    release();
    expect(crumbleMayStart({ getAnimations: () => [] })).toBe(true);
  });

  it("never waits longer than the result gate cap", () => {
    expect(CRUMBLE_GATE_CAP_MS).toBe(GATE_TIMING.resultCapMs);
  });
});

describe("the crumble wait", () => {
  it("tells the listeners once, when the crumble starts or its seat is gone", () => {
    const seen = vi.fn();
    const off = onCrumbleStart(seen);
    const end = beginCrumbleWait();
    expect(crumbleWaiting()).toBe(true);
    end();
    end();
    expect(crumbleWaiting()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    beginCrumbleWait()();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("counts every crumble that waits", () => {
    const a = beginCrumbleWait();
    const b = beginCrumbleWait();
    a();
    expect(crumbleWaiting()).toBe(true);
    b();
    expect(crumbleWaiting()).toBe(false);
  });
});

describe("pauseRegroup", () => {
  class CSSTransition {
    playState = "running";
    constructor(public delay: number, public currentTime: number | null = 0) {}
    effect = { getTiming: () => ({ delay: this.delay }) };
    pause = vi.fn(() => { this.playState = "paused"; });
    play = vi.fn(() => { this.playState = "running"; });
    finished = Promise.resolve();
  }
  class CSSAnimation extends CSSTransition {}
  const source = (list: unknown[]) => ({ getAnimations: () => list as never[] });

  it("pauses the glide transitions that are still in their delay and lets them go on after", () => {
    const waiting = new CSSTransition(2200, 40);
    const moving = new CSSTransition(2200, 2600);
    const quick = new CSSTransition(0, 0);
    const script = new CSSAnimation(2200, 0);
    const resume = pauseRegroup(source([waiting, moving, quick, script]));
    expect(waiting.pause).toHaveBeenCalledTimes(1);
    expect(moving.pause).not.toHaveBeenCalled();
    expect(quick.pause).not.toHaveBeenCalled();
    expect(script.pause).not.toHaveBeenCalled();
    resume();
    expect(waiting.play).toHaveBeenCalledTimes(1);
    resume();
    expect(waiting.play).toHaveBeenCalledTimes(1);
  });

  it("does nothing without getAnimations", () => {
    expect(() => pauseRegroup(null)()).not.toThrow();
    expect(() => pauseRegroup({} as never)()).not.toThrow();
  });
});
