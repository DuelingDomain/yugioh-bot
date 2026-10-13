// @vitest-environment jsdom
import React, { useRef } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const planner = vi.hoisted(() => ({ calls: [] as { chrome?: number; maxCard?: number }[], resize: [] as (() => void)[] }));
vi.mock("@/components/duel/table/strip-room", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/duel/table/strip-room")>();
  return {
    ...original,
    planStripRoom: (input: { chrome?: number; maxCard?: number }) => {
      planner.calls.push({ chrome: input.chrome, maxCard: input.maxCard });
      return { x: 12, y: 12, width: 420, height: 480, card: 96, cols: 3 };
    },
  };
});

import { useStripRoom } from "@/components/duel/table/use-strip-room";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) { planner.resize.push(cb); }
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
});
afterEach(() => {
  cleanup();
  planner.calls.length = 0;
  planner.resize.length = 0;
});

/** A box with a chain panel whose parts have these heights (jsdom has no layout): the panel, the strip block (bar + frame) and the frame. */
function Probe({ panel, block, frame }: { panel: number; block: number; frame: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useStripRoom({ rootRef, active: true, promptId: "p1", count: 14, box: { width: 1000, height: 600 }, keyHud: "[data-key]", softHud: "[data-soft]", hand: "[data-hand]", sourceKeys: [], viewKey: "home" });
  const size = (height: number) => (node: HTMLElement | null) => {
    if (node) node.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: height, width: 400, height, toJSON: () => ({}) });
  };
  return (
    <div ref={rootRef} data-testid="root">
      <div data-prompt-panel data-tone="chain" data-strip="true" ref={size(panel)}>
        <div data-strip-wrap ref={size(block)}>
          <div data-bar />
          <div data-strip-frame ref={size(frame)} />
        </div>
      </div>
    </div>
  );
}

describe("useStripRoom: the panel's real chrome", () => {
  it("counts the strip's own bar as chrome (the panel minus the scrolling frame, not minus the whole strip block)", async () => {
    // Panel 540, strip block 272 (a 22px bar and a 250px frame): the chrome is 540 - 250 = 290, rounded up to 296. Against the whole block it would read 268 -> 272.
    render(<Probe panel={540} block={272} frame={250} />);
    // The first plan comes at rest with the estimate; the panel then resizes (it is placed in its room) and the hook measures the chrome.
    await waitFor(() => expect(planner.calls.length).toBeGreaterThan(0), { timeout: 4000 });
    await waitFor(() => {
      planner.resize.forEach((cb) => cb());
      expect(planner.calls.some((call) => call.chrome === 296)).toBe(true);
    }, { timeout: 4000 });
    expect(planner.calls.some((call) => call.chrome === 272)).toBe(false);
  });

  it("never gives the planner less than the estimate", async () => {
    render(<Probe panel={400} block={222} frame={200} />);
    await waitFor(() => expect(planner.calls.length).toBeGreaterThan(0), { timeout: 4000 });
    planner.resize.forEach((cb) => cb());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(Math.min(...planner.calls.map((call) => call.chrome ?? Infinity))).toBeGreaterThanOrEqual(254);
  });

  it("passes the tile of the room it shows as maxCard once the chrome is measured, so the tile never grows back", async () => {
    render(<Probe panel={540} block={272} frame={250} />);
    await waitFor(() => expect(planner.calls.length).toBeGreaterThan(0), { timeout: 4000 });
    await waitFor(() => {
      planner.resize.forEach((cb) => cb());
      expect(planner.calls.some((call) => call.chrome === 296)).toBe(true);
    }, { timeout: 4000 });
    // The planner shows 96 px tiles; every plan after that one is capped at 96.
    const later = planner.calls.filter((call) => call.chrome === 296);
    expect(later.every((call) => call.maxCard === 96)).toBe(true);
  });
});
