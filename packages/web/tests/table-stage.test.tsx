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
  it("keeps decision clocks on the LP panels and clear of the dock name and turn label", () => {
    const { container } = render(<Shell id="main" />);
    // The phases moved to the hub on the board; the bar keeps the clock beside the turn button.
    const clock = container.querySelector('nav[aria-label="Turn actions"] [role="timer"]')!;
    expect(clock.textContent?.trim()).toBe("3:12");
    expect(clock.querySelector("small")).toBeNull();
    expect(container.querySelector('[data-holo="1"]')).toHaveTextContent("04:00");
    expect(container.querySelector('nav[aria-label="Duel phases"]')).toHaveTextContent("Turn 5");
  });

  it("puts the phase hub on the board at its place on the stage, and not the phases in the bar", () => {
    const { container } = render(<Shell id="main" />);
    const slot = container.querySelector<HTMLElement>("[data-hub-slot]")!;
    expect(slot).not.toBeNull();
    const hub = slot.querySelector('nav[aria-label="Duel phases"]')!;
    expect(hub.getAttribute("data-variant")).toBe("table");
    expect(hub.querySelectorAll("[data-state]")).toHaveLength(6);
    // The bar has no plate list and no turn owner label any more.
    expect(container.querySelector('nav[aria-label="Turn actions"] ol')).toBeNull();
    expect(container.querySelector('nav[aria-label="Turn actions"]')).not.toHaveTextContent("Turn 5");
    // Three duelists: one hub, not one per seat.
    expect(container.querySelectorAll("[data-hub-slot]")).toHaveLength(1);
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
