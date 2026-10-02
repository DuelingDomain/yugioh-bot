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

type StateId = keyof typeof FFA3_FIXTURES.states;
function Shell({ id }: { id: StateId }) {
  const controller = useFixtureController(FFA3_FIXTURES.states[id], { reducedMotion: true });
  return <TableShell controller={controller} />;
}

const ids = Object.keys(FFA3_FIXTURES.states) as StateId[];

describe("TableShell on the 3-way fixtures: the whole table", () => {
  it("renders every state without a console error", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const id of ids) {
      const { container, unmount } = render(<Shell id={id} />);
      expect(container.querySelector("[data-table-shell]"), id).not.toBeNull();
      unmount();
    }
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("keeps the FX hooks: one LP node per seat, zone keys, hands and card art", () => {
    const { container } = render(<Shell id="main" />);
    expect([...container.querySelectorAll("[data-lp-seat]")].map((node) => node.getAttribute("data-lp-seat")).sort()).toEqual(["0", "1", "2"]);
    expect(container.querySelectorAll("[data-zones]").length).toBeGreaterThan(30);
    expect([...container.querySelectorAll("[data-hand-seat]")].map((node) => node.getAttribute("data-hand-seat")).sort()).toEqual(["0", "1", "2"]);
    expect(container.querySelector("[data-card-art]")).not.toBeNull();
    expect(container.querySelector("[data-slot='fx']")).not.toBeNull();
  });

  it("glows usable cards with a top chip and never dims or dashes them", () => {
    const { container } = render(<Shell id="main" />);
    const glows = container.querySelectorAll("[data-state='usable']");
    expect(glows.length).toBeGreaterThan(0);
    expect(container.querySelector("[class*='dim' i]")).toBeNull();
    expect(container.querySelector("[data-dim], [data-dimmed]")).toBeNull();
  });

  it("shows the side tabs, the station track with a seat strip and the Deck Master dock per seat", () => {
    const { container } = render(<Shell id="main" />);
    expect(container.querySelector("[role='tablist']")).not.toBeNull();
    expect(container.querySelector("nav[aria-label='Duel phases'][data-seats='true']")).not.toBeNull();
    expect(container.querySelectorAll("[aria-label='Turn order'] li")).toHaveLength(3);
    expect(container.querySelector("[aria-label='Deck Masters']")).not.toBeNull();
  });

  it("writes a status word under each seat chip: choosing, next, waits", () => {
    const { container } = render(<Shell id="main" />);
    const words = [...container.querySelectorAll("[aria-label='Turn order'] [data-testid='chip-word']")].map((node) => node.textContent);
    expect(words).toHaveLength(3);
    expect(words).toContain("next");
    expect(words).toContain("waits");
    expect(words.some((word) => word === "choosing" || word === "turn")).toBe(true);
  });

  it("tints the who pill with the colour of the seat whose turn it is", () => {
    const { container } = render(<Shell id="main" />);
    const pill = container.querySelector("[data-testid='who-pill']") as HTMLElement;
    expect(pill.style.getPropertyValue("--seat-main")).toMatch(/^#|^rgb/);
    expect(pill.style.getPropertyValue("--seat-ink")).not.toBe("");
  });

  it("opens the Card tab on one of your own cards before anything is hovered", () => {
    const { container } = render(<Shell id="main" />);
    expect(container.querySelector("[data-testid='card-tab-empty']")).toBeNull();
  });

  it("puts rival Deck Masters on the holo panels, and only your own master and the camera panel in the right column", () => {
    const { container } = render(<Shell id="main" />);
    const aside = container.querySelector("[aria-label='Deck Masters']") as HTMLElement;
    expect([...aside.querySelectorAll("section h2")].map((node) => node.textContent)).toEqual(["Your Master"]);
    expect(aside.querySelector("[data-docks]")?.getAttribute("data-docks")).toBe("1");
    expect(aside.querySelector("[data-camera-panel]")).not.toBeNull();
    expect(container.querySelectorAll("[data-camera-panel]")).toHaveLength(1);
    expect(container.querySelector("[data-camera-chip]")).not.toBeNull();
    const thumbs = [...container.querySelectorAll("[data-master-thumb]")].map((node) => node.getAttribute("data-master-thumb")).sort();
    expect(thumbs).toEqual(["1", "2"]);
  });

  it("marks the duelist who left and keeps playing on", () => {
    const { container } = render(<Shell id="elimination" />);
    const out = container.querySelectorAll("[data-testid='seat-out']");
    expect(out).toHaveLength(1);
    expect(out[0].textContent).toContain("Mika Hana is out");
    expect(out[0].textContent).toContain("3rd");
  });

  it("calls the viewer a spectator and offers no action prompt", () => {
    const { container } = render(<Shell id="spectator" />);
    expect(container.textContent).toContain("You are spectating");
    expect(container.querySelector("[data-prompt-panel]")).toBeNull();
  });

  it("opens the chain response in the prompt centre", () => {
    const { container } = render(<Shell id="chain-2" />);
    expect(container.querySelector("[data-prompt-panel]")).not.toBeNull();
  });

  it("mounts the finished duel and shows the Finished lamp (the result screen waits for the board to settle)", () => {
    const { container } = render(<Shell id="result" />);
    expect(container.textContent).toContain("Finished");
  });

  it("ignores table keys typed in a field", () => {
    const { container } = render(<Shell id="main" />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    const before = container.querySelector("[data-table-stage]")?.getAttribute("data-camera-mode");
    act(() => void fireEvent.keyDown(input, { key: "0", bubbles: true }));
    expect(container.querySelector("[data-table-stage]")?.getAttribute("data-camera-mode")).toBe(before);
    input.remove();
  });
});
