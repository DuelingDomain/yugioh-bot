// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrackLayer, FieldCracks, resetCrackMemory } from "@/components/duel/field-cracks/field-cracks";
import { FieldCracksScope } from "@/components/duel/field-cracks/context";

/* jsdom has no layout: give every element a mat-sized box, and a body to hang the debris layer on. */
const animate = vi.fn((..._args: unknown[]) => ({ finished: new Promise(() => {}), playbackRate: 1, cancel() {}, effect: null }));

beforeEach(() => {
  vi.useFakeTimers();
  resetCrackMemory();
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: animate });
  // A zone carries its box in data-box="x,y,w,h"; the mat is 653 x 380.
  const box = (el: Element) => (el.getAttribute("data-box") ?? "0,0,653,380").split(",").map(Number);
  for (const [prop, at] of [["clientWidth", 2], ["clientHeight", 3]] as const) {
    Object.defineProperty(Element.prototype, prop, { configurable: true, get(this: Element) { return box(this)[at]; } });
  }
  for (const [prop, at] of [["offsetLeft", 0], ["offsetTop", 1], ["offsetWidth", 2], ["offsetHeight", 3]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get(this: Element) { return box(this)[at]; } });
  }
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get(this: HTMLElement) { return this.parentElement?.closest("[data-testid=face]") ?? document.body; } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const prop of ["clientWidth", "clientHeight"]) delete (Element.prototype as unknown as Record<string, unknown>)[prop];
  for (const prop of ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop", "offsetParent"]) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
});

/* Two rows of five zones, like a seat field: the gutters between them are where the cracks may run. */
const ZONES = [0, 1, 2, 3, 4].flatMap((col) => [[40 + col * 115, 40], [40 + col * 115, 200]] as const);

const mat = (stage: 0 | 1 | 2 | 3 | 4, extra: Partial<React.ComponentProps<typeof CrackLayer>> = {}, reduced = false) => (
  <div data-reduced-motion={reduced ? "true" : undefined}>
    <div data-testid="face">
      <CrackLayer seed={77} stage={stage} memoKey="duel:0" {...extra} />
      {ZONES.map(([x, y]) => <div key={`${x}:${y}`} data-zones="" data-kind="monster" data-box={`${x},${y},77,112`} />)}
    </div>
  </div>
);
const layer = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-field-cracks]")!;
const segs = (c: HTMLElement) => c.querySelectorAll("[data-seg]").length;
const debris = () => document.querySelector("[data-crack-debris]");
const flush = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("field cracks component", () => {
  it("draws nothing at stage 0", () => {
    const { container } = render(mat(0));
    expect(layer(container).getAttribute("data-stage")).toBe("0");
    expect(segs(container)).toBe(0);
  });

  it("does not animate when it mounts at a stage that is already reached", () => {
    const { container } = render(mat(2));
    flush(3000);
    expect(layer(container).getAttribute("data-stage")).toBe("2");
    expect(segs(container)).toBeGreaterThan(0);
    expect(animate).not.toHaveBeenCalled();
    expect(debris()).toBeNull();
  });

  it("spreads and drops chunks when the stage rises", () => {
    const { container, rerender } = render(mat(0));
    rerender(mat(1));
    expect(layer(container).getAttribute("data-stage")).toBe("1");
    expect(animate).toHaveBeenCalled();
    flush(1500);
    expect(debris()).not.toBeNull();
  });

  it("shows a stage that rises at once, with no debris, under reduced motion", () => {
    const { container, rerender } = render(mat(0, {}, true));
    rerender(mat(3, {}, true));
    flush(3000);
    expect(layer(container).getAttribute("data-stage")).toBe("3");
    expect(segs(container)).toBeGreaterThan(0);
    expect(animate).not.toHaveBeenCalled();
    expect(debris()).toBeNull();
  });

  it("keeps the cracks when the LP goes back up", () => {
    const { container, rerender } = render(mat(0));
    rerender(mat(2));
    flush(3000);
    rerender(mat(0));
    expect(layer(container).getAttribute("data-stage")).toBe("2");
  });

  it("follows the LP down again in mend mode", () => {
    const { container, rerender } = render(mat(2, { regainMode: "mend" }));
    rerender(mat(0, { regainMode: "mend" }));
    expect(layer(container).getAttribute("data-stage")).toBe("0");
  });

  it("does not play the cracks again after a remount", () => {
    const first = render(mat(0));
    first.rerender(mat(2));
    flush(3000);
    first.unmount();
    animate.mockClear();
    const { container } = render(mat(2));
    flush(3000);
    expect(layer(container).getAttribute("data-stage")).toBe("2");
    expect(animate).not.toHaveBeenCalled();
  });

  it("shows the stage of a replay without animation", () => {
    const { container, rerender } = render(mat(0, { replay: true }));
    rerender(mat(3, { replay: true }));
    flush(3000);
    expect(layer(container).getAttribute("data-stage")).toBe("3");
    expect(animate).not.toHaveBeenCalled();
    expect(debris()).toBeNull();
  });

  it("marks its layer ambient so the result gate never waits for it", () => {
    const { container } = render(mat(1));
    expect(layer(container).hasAttribute("data-crack-ambient")).toBe(true);
  });
});

describe("FieldCracks scope", () => {
  it("renders nothing without a scope", () => {
    const { container } = render(<div><FieldCracks seat={0} lp={100} /></div>);
    expect(container.querySelector("[data-field-cracks]")).toBeNull();
  });

  it("takes its stage from the LP and the starting LP of the scope", () => {
    const { container } = render(
      <FieldCracksScope duelKey="d1" startLp={8000}>
        <div><FieldCracks seat={0} lp={700} /></div>
      </FieldCracksScope>,
    );
    expect(layer(container).getAttribute("data-stage")).toBe("3");
  });
});
