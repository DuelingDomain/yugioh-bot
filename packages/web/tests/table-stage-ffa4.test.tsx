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

  it("leaves the hidden camera alone on the grid: camera keys do nothing, Tab is not prevented, S still turns upright", () => {
    const { container } = render(<Shell id="main" />);
    const stage = container.querySelector("[data-table-stage]")!;
    const key = (name: string) => {
      let allowed = true;
      act(() => {
        allowed = fireEvent.keyDown(window, { key: name });
      });
      return allowed;
    };
    expect(key("Tab")).toBe(true);
    for (const name of ["4", "1", "0", "h", "o", "f", "p", "k", "a", "c"]) key(name);
    expect(stage.getAttribute("data-camera-mode")).toBe("home");
    expect(stage.getAttribute("data-camera-want")).toBe("home");
    const upright = stage.getAttribute("data-upright");
    expect(key("s")).toBe(false);
    expect(stage.getAttribute("data-upright")).not.toBe(upright);
  });

  it("does not make the seat strip a camera: no focus buttons, no focused seat", () => {
    const { container } = render(<Shell id="main" />);
    expect(container.querySelectorAll("[data-testid^='seat-strip-'][data-seat]")).toHaveLength(4);
    expect(container.querySelectorAll('[aria-label^="Show "][aria-label$=" on the main field"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid^="seat-strip-"][data-focus="true"]')).toHaveLength(0);
  });

  it("C keeps the four full fields on the grid: no chips, no camera move on the board", () => {
    const { container } = render(<Shell id="main" />);
    press("c");
    expect(container.querySelectorAll("[data-compact-chips]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-seat-field]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-lp-seat]")).toHaveLength(4);
    expect(container.querySelector('[data-table-shell][data-grid="true"]')).not.toBeNull();
    expect(container.querySelector("[data-grid-stage]")).not.toBeNull();
  });

  it("draws no camera controls on the grid", () => {
    const { container } = render(<Shell id="main" />);
    expect(container.querySelector("[data-camera-panel]")).toBeNull();
    expect(container.querySelector("[data-camera-chip]")).toBeNull();
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
