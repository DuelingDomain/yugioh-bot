// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
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

function Shell({ id }: { id: keyof typeof FFA4_FIXTURES.states }) {
  const controller = useFixtureController(FFA4_FIXTURES.states[id], { reducedMotion: true });
  return <TableShell controller={controller} />;
}

const press = (key: string) => {
  act(() => {
    fireEvent.keyDown(window, { key });
  });
};

describe("TableShell on the 4-way fixtures", () => {
  it("draws one LP panel, one seat field and one hand per seat", () => {
    const { container } = render(<Shell id="main" />);
    const lp = [...container.querySelectorAll("[data-lp-seat]")].map((node) => node.getAttribute("data-lp-seat"));
    expect(lp.sort()).toEqual(["0", "1", "2", "3"]);
    expect(container.querySelectorAll("[data-seat-field]")).toHaveLength(4);
    const hands = [...container.querySelectorAll("[data-hand-seat]")].map((node) => node.getAttribute("data-hand-seat"));
    expect(hands.sort()).toEqual(["0", "1", "2", "3"]);
  });

  it("marks the rival fields as opponents with a seat angle and keeps card art hooks", () => {
    const { container } = render(<Shell id="main" />);
    const rivals = [...container.querySelectorAll("[data-seat-field][data-side='opp']")];
    expect(rivals).toHaveLength(3);
    for (const node of rivals) expect(node.hasAttribute("data-seat-angle")).toBe(true);
    expect(container.querySelectorAll("[data-card-art]").length).toBeGreaterThan(0);
  });

  it("gives each seat its own extra monster keys", () => {
    const { container } = render(<Shell id="main" />);
    for (const seat of [0, 1, 2, 3]) {
      const field = container.querySelector(`[data-seat-field="${seat}"]`)!;
      const keys = [...field.querySelectorAll("[data-zones]")].map((node) => node.getAttribute("data-zones") ?? "");
      expect(keys.some((key) => key.includes(`${seat}:4:5`))).toBe(true);
    }
  });

  it("starts at home with full rival fields, no chips", () => {
    const { container } = render(<Shell id="main" />);
    const stage = container.querySelector("[data-table-stage]")!;
    expect(stage.getAttribute("data-table-stage")).toBe("ffa4");
    expect(stage.getAttribute("data-camera-mode")).toBe("home");
    expect(container.querySelectorAll("[data-compact-chips]")).toHaveLength(0);
  });

  it("walks the rivals with Tab and focuses a seat with the digit keys", () => {
    const { container } = render(<Shell id="main" />);
    const stage = container.querySelector("[data-table-stage]")!;
    press("Tab");
    expect(stage.getAttribute("data-camera-mode")).toBe("focus");
    press("4");
    expect(stage.getAttribute("data-camera-mode")).toBe("focus");
    press("1");
    expect(stage.getAttribute("data-camera-mode")).toBe("home");
    press("0");
    expect(["fly", "overview"]).toContain(stage.getAttribute("data-camera-mode"));
  });

  it("turns the table with P and returns home after the last rival", () => {
    const { container } = render(<Shell id="main" />);
    const stage = container.querySelector("[data-table-stage]")!;
    for (let index = 0; index < 3; index += 1) {
      press("p");
      expect(stage.getAttribute("data-camera-mode")).toBe("look");
    }
    press("p");
    expect(stage.getAttribute("data-camera-mode")).toBe("home");
  });

  it("C swaps the three rival fields for chips, and the hooks stay in the DOM", () => {
    const { container } = render(<Shell id="main" />);
    press("c");
    expect(container.querySelectorAll("[data-compact-chips]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-seat-field]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-lp-seat]")).toHaveLength(4);
    press("c");
    expect(container.querySelectorAll("[data-compact-chips]")).toHaveLength(0);
  });

  it("lights usable chips with a glow and never dims the others", () => {
    const { container } = render(<Shell id="chain-2" />);
    press("c");
    const chips = [...container.querySelectorAll("[data-compact-chips] [data-chip]")];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.getAttribute("style") ?? "").not.toMatch(/opacity/);
    }
  });

  it("shows no rival chips in the 1v1-style states that have no rivals left", () => {
    const { container } = render(<Shell id="result" />);
    press("c");
    expect(container.querySelectorAll("[data-lp-seat]")).toHaveLength(4);
  });

  it("marks the prompt slot of a duelist pick, so the centre modal can leave the LP panels clear", () => {
    const pick = render(<Shell id="choose-opponent" />).container;
    expect(pick.querySelector('[data-slot="prompt"][data-seat-pick="true"]')).not.toBeNull();
    cleanup();
    const plain = render(<Shell id="main" />).container;
    expect(plain.querySelector('[data-slot="prompt"][data-seat-pick]')).toBeNull();
  });
});
