// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANIMATION_SPEED_KEY, loadAnimationSpeed, normalizeAnimationSpeed, saveAnimationSpeed, setAnimationSpeed } from "@/components/duel/animation-speed";
import { createDuelFxClock } from "@/components/duel/fx-clock";
import { DuelAnimationSpeedControl } from "@/components/duel/animation-speed-control";

beforeEach(() => {
  window.localStorage.clear();
  setAnimationSpeed(1);
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
});
