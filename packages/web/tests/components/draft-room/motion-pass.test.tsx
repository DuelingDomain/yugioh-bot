// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionMenu } from "../../../src/components/draft/room/motion-menu";
import { SayMenu } from "../../../src/components/draft/room/say-menu";
import { animate, flight, setCurrentMotion, stagger, popExitMs } from "../../../src/components/draft/room/motion";

const css = readFileSync(join(__dirname, "../../../src/components/draft/room/draft-room.css"), "utf8");
const block = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

let reduced = false;
beforeEach(() => {
  reduced = false;
  setCurrentMotion("full");
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && reduced,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setCurrentMotion("full");
});

describe("popovers keep their place for the exit", () => {
  const menu = (open: boolean, onClose = () => {}) => (
    <MotionMenu open={open} anchor={document.body} level="full" onChoose={() => {}} onClose={onClose} />
  );

  it("stays in the DOM, closed and inert, until the exit has run", () => {
    vi.useFakeTimers();
    const { rerender } = render(menu(true));
    const pop = document.getElementById("motionPop")!;
    expect(pop).toHaveAttribute("data-state", "open");
    expect(pop).not.toHaveAttribute("inert");

    rerender(menu(false));
    expect(document.getElementById("motionPop")).toBe(pop);
    expect(pop).toHaveAttribute("data-state", "closed");
    expect(pop).toHaveAttribute("inert");
    expect(pop).toHaveAttribute("aria-hidden", "true");
    // a closing dialog is out of the accessibility tree, so it can't be reached while it fades
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => void vi.advanceTimersByTime(popExitMs() - 1));
    expect(document.getElementById("motionPop")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    expect(document.getElementById("motionPop")).toBeNull();
  });

  it("leaves at once when the room's animations are Off", () => {
    vi.useFakeTimers();
    setCurrentMotion("off");
    const { rerender } = render(menu(true));
    rerender(menu(false));
    act(() => void vi.advanceTimersByTime(1));
    expect(document.getElementById("motionPop")).toBeNull();
  });

  it("comes back to life when it is reopened during the exit", () => {
    vi.useFakeTimers();
    const { rerender } = render(menu(true));
    rerender(menu(false));
    act(() => void vi.advanceTimersByTime(40));
    rerender(menu(true));
    const pop = document.getElementById("motionPop")!;
    expect(pop).toHaveAttribute("data-state", "open");
    expect(pop).not.toHaveAttribute("inert");
    act(() => void vi.advanceTimersByTime(500));
    expect(document.getElementById("motionPop")).toBe(pop);
  });

  it("ignores Escape and outside presses while it is closing", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = render(menu(true, onClose));
    rerender(menu(false, onClose));
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the say menu keeps its anchor for the exit", () => {
    vi.useFakeTimers();
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const say = (open: boolean, a: HTMLElement | null) => (
      <SayMenu open={open} anchor={a} waiting={false} onSay={() => {}} onClose={() => {}} />
    );
    const { rerender } = render(say(true, anchor));
    rerender(say(false, null));
    const pop = document.getElementById("sayPop")!;
    expect(pop).toHaveAttribute("data-state", "closed");
    act(() => void vi.advanceTimersByTime(popExitMs() + 1));
    expect(document.getElementById("sayPop")).toBeNull();
    anchor.remove();
  });
});

describe("the room's animate() and flight() follow the motion level", () => {
  const frames: Keyframe[] = [{ transform: "translateY(10px)", opacity: 0 }, { transform: "none", opacity: 1 }];
  const el = () => {
    const node = document.createElement("div");
    const spy = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation);
    node.animate = spy as unknown as typeof node.animate;
    return { node, spy };
  };

  it("Full runs what it is given", () => {
    const { node, spy } = el();
    void animate(node, frames, { duration: 300, delay: 40 });
    expect(spy).toHaveBeenCalledWith(frames, { duration: 300, delay: 40 });
  });

  it("Calm keeps the fade, drops the distance and shortens the time", () => {
    setCurrentMotion("calm");
    const { node, spy } = el();
    void animate(node, frames, { duration: 300 });
    expect(spy).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
  });

  it("reduced motion is opacity only, and never longer than 140ms", () => {
    reduced = true;
    const { node, spy } = el();
    void animate(node, frames, { duration: 600 });
    expect(spy).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
  });

  it("an animation that is only movement does nothing when movement is off the table", () => {
    setCurrentMotion("calm");
    const { node, spy } = el();
    void animate(node, [{ transform: "none" }, { transform: "scale(1.1)" }], { duration: 300 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("Off does nothing", () => {
    setCurrentMotion("off");
    const { node, spy } = el();
    void animate(node, frames, { duration: 300 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a card only flies on Full with no reduced-motion request", async () => {
    const rect = { left: 0, top: 0, width: 100, height: 140 };
    for (const [level, wantsReduced] of [["calm", false], ["full", true]] as const) {
      setCurrentMotion(level);
      reduced = wantsReduced;
      const layer = document.createElement("div");
      layer.animate = vi.fn() as unknown as typeof layer.animate;
      await flight({ layer, from: rect, to: { ...rect, left: 300 } });
      expect(layer.children.length).toBe(0);
      expect(layer.animate).not.toHaveBeenCalled();
    }
  });

  it("staggers 20ms a card, stops at the eighth, and does not stagger without travel", () => {
    expect([0, 1, 7, 8, 20].map(stagger)).toEqual([0, 20, 140, 140, 140]);
    setCurrentMotion("calm");
    expect(stagger(5)).toBe(0);
  });
});

describe("the room's stylesheet uses the site's timing", () => {
  it("popovers and the finale have an enter and an exit", () => {
    expect(css).toMatch(/\.dr \.pop\[data-state="open"\] \{ animation: dr-pop-in var\(--rm-pop-in\) var\(--ease-out\)/);
    expect(css).toMatch(/\.dr \.pop\[data-state="closed"\] \{ animation: dr-pop-out var\(--rm-pop-out\) var\(--ease-out\)/);
    expect(css).toMatch(/\.dr \.finale\[data-state="closed"\] \{ animation: dr-fade-out/);
  });

  it("the room's timing variables come from the site tokens", () => {
    const vars = block(".dr");
    // the first `.dr {` is the room's own look; the timing block is the one that defines --rm-pop-in
    const at = css.indexOf("--rm-pop-in: var(--d-pop-in)");
    expect(at).toBeGreaterThan(-1);
    expect(vars).toBeTruthy();
    for (const pair of [
      "--rm-pop-out: var(--d-pop-out)",
      "--rm-sheet-in: var(--d-drawer-in)",
      "--rm-sheet-out: var(--d-drawer-out)",
      "--rm-press: var(--d-press)",
      "--rm-roll: var(--d-roll)",
      "--rm-wash: var(--d-wash)",
      "--rm-move: var(--d-flip)",
    ]) {
      expect(css, pair).toContain(pair);
    }
  });

  it("Calm shortens and stops travelling; reduced motion uses --d-rm", () => {
    const calm = block('.dr[data-motion="calm"]');
    expect(calm).toContain("--rm-travel: 0");
    expect(calm).toContain("--rm-pop-scale: 1");
    expect(calm).toContain("calc(var(--d-pop-in) * 0.6)");
    const reducedAt = css.indexOf("--rm-pop-in: var(--d-rm)");
    expect(reducedAt).toBeGreaterThan(css.indexOf('.dr[data-motion="calm"] {'));
    expect(css.slice(reducedAt - 200, reducedAt)).toContain("prefers-reduced-motion");
  });

  it("only the room fades in, and Off shortens that fade instead of removing it", () => {
    expect(css).toContain(".dr[data-turn] { animation: dr-fade-in");
    expect(css).toContain('.dr[data-turn][data-motion="off"] { animation-duration: 0s; }');
  });

  it("Calm fades the sheets instead of sliding them, and a re-placed card just changes place", () => {
    expect(css).toContain('.dr[data-motion="calm"] .dock { opacity: 0;');
    expect(css).toContain('.dr[data-motion="calm"] .binder-panel { opacity: 0;');
    expect(css).toContain('.dr[data-motion="calm"] .tcard { transition: none; }');
  });

  it("the phone sheet and the binder slide on the drawer curve, and leave faster than they arrive", () => {
    expect(css).toContain("transition: transform var(--rm-sheet-out) var(--ease-drawer)");
    expect(css).toContain('.dr[data-sheet="card"] .dock { transform: none; transition-duration: var(--rm-sheet-in); }');
    expect(css).toContain('.dr[data-sheet="binder"] .binder-panel { transform: none; transition-duration: var(--rm-sheet-in); }');
    expect(css).toContain(".dr[data-binder] .binder-panel { transform: none; transition-duration: var(--rm-sheet-in); }");
  });

  it("the Pick button presses with the site's press scale", () => {
    expect(block(".dr .pick-btn")).toContain("transition: transform var(--rm-press) var(--ease-out)");
    expect(css).toContain("transform: scale(var(--motion-press))");
  });

  it("a standing card and the table slide use the site curves", () => {
    expect(block(".dr .tcard .lift")).toContain("transition: transform var(--rm-stand) var(--ease-out)");
    expect(block(".dr .tcard")).toContain("transition: transform var(--rm-move) var(--ease-in-out)");
  });

  it("a count rolls in from below and a new row arrives with an overlay wash, with no overshoot and no background animation", () => {
    expect(css).toContain("@keyframes dr-roll { from { opacity: 0; transform: translateY(calc(55% * var(--rm-travel))); } }");
    expect(css).not.toContain("dr-bump");
    expect(css).toContain("@keyframes dr-rowwash { from { opacity: 1; } }");
    // at rest the wash is invisible, so turning animations Off never leaves it on the row
    expect(block(".dr li[data-new] > .row-btn.flash::before")).toContain("opacity: 0;");
    const rowin = css.slice(css.indexOf("@keyframes dr-rowin"), css.indexOf("\n", css.indexOf("@keyframes dr-rowin")));
    expect(rowin).not.toContain("background");
  });

  it("the room's motion rules animate transform and opacity only", () => {
    const frames = [...css.matchAll(/@keyframes (dr-(?:pop-in|pop-out|fade-in|fade-out|roll|rowin|rowwash))\s*\{([^]*?)\}\s*(?=\n)/g)];
    expect(frames.length).toBe(7);
    for (const [, name, body] of frames) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(props.length, name).toBeGreaterThan(0);
      for (const prop of props) expect(["opacity", "transform"], `${name}: ${prop}`).toContain(prop);
    }
  });
});
