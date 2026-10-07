// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(cleanup);

function Shell({ id }: { id: keyof typeof FFA3_FIXTURES.states }) {
  const controller = useFixtureController(FFA3_FIXTURES.states[id], { reducedMotion: true });
  return <TableShell controller={controller} />;
}

describe("TableShell on the 3-way fixtures", () => {
  it("keeps decision clocks in the header block, off the bar and clear of the dock name and turn label", () => {
    const { container } = render(<Shell id="main" />);
    // The clocks of every seat moved to the top-left block of the header; the bar keeps no clock beside the turn button.
    const bank = container.querySelector('[data-testid="hud-clocks"]')!;
    expect(bank).not.toBeNull();
    expect(bank.getAttribute("data-count")).toBe("3");
    const cells = bank.querySelectorAll('[data-testid="clock-cell"]');
    expect(cells).toHaveLength(3);
    expect(bank).toHaveTextContent("3:12");
    expect(bank).toHaveTextContent("4:00");
    expect(container.querySelector('nav[aria-label="Turn actions"] [role="timer"]')).toBeNull();
    // The clocks sit in neither the dock (name, turn label) nor the LP panels.
    expect(container.querySelector('nav[aria-label="Turn actions"]')?.contains(bank)).toBe(false);
    expect(container.querySelector('[data-holo="1"]')?.contains(bank)).toBe(false);
    expect(container.querySelector('[data-holo="1"] [role="timer"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="Duel phases"]')).toHaveTextContent("Turn 5");
  });

  it("puts the phase hub on the board at its place on the stage, and not the phases in the bar", () => {
    const { container } = render(<Shell id="main" />);
    const slot = container.querySelector<HTMLElement>("[data-hub-slot]")!;
    expect(slot).not.toBeNull();
    const hub = slot.querySelector('nav[aria-label="Duel phases"]')!;
    expect(hub.getAttribute("data-variant")).toBe("table");
    expect(hub.querySelectorAll("[data-state]")).toHaveLength(6);
    // The bar has no phase plates and no turn owner label any more (its left block keeps the turn order that Wide plaza put there).
    expect(container.querySelector('nav[aria-label="Turn actions"] [data-state]')).toBeNull();
    expect(container.querySelector('nav[aria-label="Turn actions"]')).not.toHaveTextContent("Turn 5");
    // Three duelists: one hub, not one per seat.
    expect(container.querySelectorAll("[data-hub-slot]")).toHaveLength(1);
  });

  it("puts every prompt in the middle of your field, at a size that follows it", () => {
    const { container } = render(<Shell id="chain-2" />);
    const board = container.querySelector<HTMLElement>("[data-prompt-center]")!;
    expect(board).not.toBeNull();
    expect(board.hasAttribute("data-panel-room")).toBe(false);
    const slot = board.querySelector<HTMLElement>('[data-slot="prompt"]')!;
    expect(slot.hasAttribute("data-prompt-dense")).toBe(true);
    const cx = parseFloat(slot.style.getPropertyValue("--pr-cx"));
    const width = parseFloat(slot.style.getPropertyValue("--pr-w"));
    // Your field is the near board in the middle of the 1100 px box.
    expect(Math.abs(cx - 550)).toBeLessThan(4);
    expect(width).toBeGreaterThan(300);
    expect(parseFloat(slot.style.getPropertyValue("--pr-unit"))).toBeGreaterThan(0);
  });

  it("draws one LP panel per seat and one seat field per seat", () => {
    const { container } = render(<Shell id="main" />);
    const lp = [...container.querySelectorAll("[data-lp-seat]")].map((node) => node.getAttribute("data-lp-seat"));
    expect(lp.sort()).toEqual(["0", "1", "2"]);
    expect(container.querySelectorAll("[data-seat-field]")).toHaveLength(3);
  });

  it("puts data-hand-seat on every hand, one per seat, backs for rivals", () => {
    const { container } = render(<Shell id="main" />);
    const hands = [...container.querySelectorAll("[data-hand-seat]")].map((node) => node.getAttribute("data-hand-seat"));
    expect(hands.sort()).toEqual(["0", "1", "2"]);
    expect(container.querySelectorAll("[data-seat-field='1'] [data-hand-seat], [data-seat-field='2'] [data-hand-seat]")).toHaveLength(2);
  });

  it("gives each seat its own extra monster keys and marks every zone", () => {
    const { container } = render(<Shell id="main" />);
    for (const seat of [0, 1, 2]) {
      const field = container.querySelector(`[data-seat-field="${seat}"]`)!;
      const keys = [...field.querySelectorAll("[data-zones]")].map((node) => node.getAttribute("data-zones") ?? "");
      expect(keys.some((key) => key.includes(`${seat}:4:5`))).toBe(true);
      expect(keys.some((key) => key.includes(`${seat}:4:6`))).toBe(true);
    }
  });

  it("toggles upright text with the S key", () => {
    const { container } = render(<Shell id="main" />);
    const stage = container.querySelector("[data-table-stage]")!;
    expect(stage.getAttribute("data-upright")).toBe("false");
    act(() => {
      fireEvent.keyDown(window, { key: "s" });
    });
    expect(stage.getAttribute("data-upright")).toBe("true");
    act(() => {
      fireEvent.keyDown(window, { key: "S" });
    });
    expect(stage.getAttribute("data-upright")).toBe("false");
  });
});
