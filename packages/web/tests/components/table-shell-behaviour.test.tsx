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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type StateId = keyof typeof FFA3_FIXTURES.states;
function Shell({ id }: { id: StateId }) {
  const controller = useFixtureController(FFA3_FIXTURES.states[id], { reducedMotion: true });
  return <TableShell controller={controller} />;
}

/** The answers the fixture controller logged, oldest first. */
function answers(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.filter((call) => call[0] === "[table-preview] answer").map((call) => (call[1] as { answer: unknown }).answer);
}

const mediaStub = (narrow: boolean) => (query: string) => ({ matches: narrow && query.includes("max-width"), media: query, addEventListener: () => {}, removeEventListener: () => {} });

describe("TableShell on the 3-way fixtures: phone width", () => {
  it("swaps the left column for a Card/Log bar and a sheet, and keeps one seat switcher", () => {
    vi.stubGlobal("matchMedia", mediaStub(true));
    try {
      const { container, getByRole } = render(<Shell id="main" />);
      expect(container.querySelector("aside[class*='inspector']")).toBeNull();
      expect(container.querySelector("[data-testid='history-strip']")).toBeNull();
      const bar = container.querySelector("[aria-label='Mobile duel panels']") as HTMLElement;
      expect(bar).not.toBeNull();
      expect([...bar.querySelectorAll("button")].map((node) => node.textContent?.replace(/\d+\+?$/, ""))).toEqual(["Card", "Log", "Settings"]);
      act(() => void fireEvent.click(getByRole("button", { name: /^Log/ })));
      expect(document.body.querySelector("[role='dialog']")).not.toBeNull();
      const switcher = container.querySelector("[data-seat-switcher]") as HTMLElement;
      expect([...switcher.querySelectorAll("[data-seat-switch]")].map((node) => node.getAttribute("data-seat-switch"))).toEqual(["home", "1", "2", "overview"]);
    } finally {
      vi.stubGlobal("matchMedia", mediaStub(false));
    }
  });

  it("switches the camera from the seat switcher", () => {
    const { container } = render(<Shell id="main" />);
    const stage = () => container.querySelector("[data-table-stage]") as HTMLElement;
    act(() => void fireEvent.click(container.querySelector("[data-seat-switch='1']") as HTMLElement));
    expect(stage().getAttribute("data-camera-mode")).toBe("focus");
    act(() => void fireEvent.click(container.querySelector("[data-seat-switch='overview']") as HTMLElement));
    expect(stage().getAttribute("data-camera-mode")).toMatch(/^(overview|fly)$/);
    act(() => void fireEvent.click(container.querySelector("[data-seat-switch='home']") as HTMLElement));
    expect(stage().getAttribute("data-camera-mode")).toBe("home");
  });
});

describe("TableShell on the 3-way fixtures: what a click does", () => {
  it("main: a usable hand card opens its menu, and choosing an action answers {choice}", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(<Shell id="main" />);
    const card = container.querySelector("[data-hand-seat='0'] [data-zones][data-legal='true']") as HTMLElement;
    expect(card).not.toBeNull();
    act(() => void fireEvent.click(card.querySelector("button") ?? card));
    const items = document.body.querySelectorAll("[role='menu'] [role='menuitem']");
    expect(items.length).toBeGreaterThan(0);
    act(() => void fireEvent.click(items[0]));
    const sent = answers(info);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ choice: expect.any(String) });
  });

  it("battle-aim: the aimed target shows the confirm, and Attack answers with the selected target", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { container } = render(<Shell id="battle-aim" />);
    const target = container.querySelector("[data-zones][data-legal='true']") as HTMLElement;
    expect(target).not.toBeNull();
    act(() => void fireEvent.click(target.querySelector("button") ?? target));
    const go = document.body.querySelector("[data-attack-confirm] button[data-go]") as HTMLElement;
    expect(go).not.toBeNull();
    act(() => void fireEvent.click(go));
    const sent = answers(info) as Array<{ selected?: unknown }>;
    expect(sent).toHaveLength(1);
    expect(sent[0].selected).toBeDefined();
  });

  it("chain-2: Yes activates, No passes", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const yes = render(<Shell id="chain-2" />);
    act(() => void fireEvent.click(yes.getByRole("button", { name: "Yes" })));
    expect(answers(info)).toEqual([{ choice: "activate" }]);
    yes.unmount();
    info.mockClear();
    const no = render(<Shell id="chain-2" />);
    act(() => void fireEvent.click(no.getByRole("button", { name: "No" })));
    expect(answers(info)).toEqual([{ cancel: true }]);
  });

  it("opening a pile and pressing O leaves the camera mode alone", () => {
    const { container } = render(<Shell id="main" />);
    const stage = () => container.querySelector("[data-table-stage]") as HTMLElement;
    const before = stage().getAttribute("data-camera-mode");
    const pile = container.querySelector("button[aria-label*='Graveyard' i], button[aria-label*='pile' i]") as HTMLElement | null;
    expect(pile).not.toBeNull();
    act(() => void fireEvent.click(pile as HTMLElement));
    act(() => void fireEvent.keyDown(window, { key: "o" }));
    expect(stage().getAttribute("data-camera-mode")).toBe(before);
  });
});
