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
  it("tells the listeners once, when the crumble starts", () => {
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

  it("tells the listeners only when no other crumble waits any more", () => {
    const seen = vi.fn();
    const off = onCrumbleStart(seen);
    const a = beginCrumbleWait();
    const b = beginCrumbleWait();
    a();
    expect(crumbleWaiting()).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    b();
    expect(crumbleWaiting()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("tells the listeners in a microtask when a seat goes while it waits, once, and not when a new wait began by then", async () => {
    const seen = vi.fn();
    const off = onCrumbleStart(seen);
    const a = beginCrumbleWait();
    const b = beginCrumbleWait();
    a.drop();
    b.drop();
    expect(seen).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(seen).toHaveBeenCalledTimes(1);

    // A StrictMode double effect: the cleanup and the new wait come in one task.
    const first = beginCrumbleWait();
    first.drop();
    const again = beginCrumbleWait();
    await Promise.resolve();
    expect(seen).toHaveBeenCalledTimes(1);
    again();
    expect(seen).toHaveBeenCalledTimes(2);
    first.drop();
    await Promise.resolve();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });
});

describe("pauseRegroup", () => {
  class CSSTransition {
    playState = "running";
    effect: { target: Element; getTiming: () => { delay: number } };
    constructor(public delay: number, target: Element, public currentTime: number | null = 0) {
      this.effect = { target, getTiming: () => ({ delay: this.delay }) };
    }
    pause = vi.fn(() => { this.playState = "paused"; });
    play = vi.fn(() => { this.playState = "running"; });
    finished = Promise.resolve();
  }
  class CSSAnimation extends CSSTransition {}
  const stage = (list: unknown[]) => ({ getAnimations: () => list as never[] });
  const glideSeat = () => {
    const el = document.createElement("div");
    el.setAttribute("data-glide", "true");
    document.body.append(el);
    return el;
  };

  it("pauses the glide transitions that are still in their delay and lets them go on after", () => {
    const seat = glideSeat();
    const waiting = new CSSTransition(2200, seat, 40);
    const moving = new CSSTransition(2200, seat, 2600);
    const quick = new CSSTransition(0, seat, 0);
    const script = new CSSAnimation(2200, seat, 0);
    const resume = pauseRegroup(stage([waiting, moving, quick, script]));
    expect(waiting.pause).toHaveBeenCalledTimes(1);
    expect(moving.pause).not.toHaveBeenCalled();
    expect(quick.pause).not.toHaveBeenCalled();
    expect(script.pause).not.toHaveBeenCalled();
    resume();
    expect(waiting.play).toHaveBeenCalledTimes(1);
    resume();
    expect(waiting.play).toHaveBeenCalledTimes(1);
    seat.remove();
  });

  it("leaves the transitions that are not part of the regroup alone (the LP colour, the chain slot, the HUD)", () => {
    const seat = glideSeat();
    const other = document.createElement("div");
    document.body.append(other);
    const strip = document.createElement("div");
    strip.setAttribute("data-regroup", "true");
    const hub = document.createElement("div");
    hub.setAttribute("data-hub-slot", "true");
    const plain = document.createElement("div");
    strip.append(hub, plain);
    document.body.append(strip);
    const lp = new CSSTransition(2200, other, 0);
    const slot = new CSSTransition(2200, plain, 0);
    const hubTransition = new CSSTransition(2200, hub, 0);
    const resume = pauseRegroup(stage([lp, slot, hubTransition]));
    expect(lp.pause).not.toHaveBeenCalled();
    expect(slot.pause).not.toHaveBeenCalled();
    expect(hubTransition.pause).toHaveBeenCalledTimes(1);
    resume();
    seat.remove();
    other.remove();
    strip.remove();
  });

  it("does nothing without getAnimations", () => {
    expect(() => pauseRegroup(null)()).not.toThrow();
    expect(() => pauseRegroup({} as never)()).not.toThrow();
  });
});
