// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  it.each(ids)("renders %s without a console error", (id) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container, unmount } = render(<Shell id={id} />);
      expect(container.querySelector("[data-table-shell]"), id).not.toBeNull();
      unmount();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
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

  it("keeps the side content in closed edge drawers: Log, Settings and Camera, no Chain, no rail and no bottom bar", () => {
    const { container } = render(<Shell id="main" />);
    expect(container.querySelector("[data-hud='true'][data-plaza-hud='true']")).not.toBeNull();
    expect(container.querySelector("nav[aria-label='Duel phases']")).not.toBeNull();
    expect(container.querySelectorAll("[aria-label='Turn order'] li")).toHaveLength(3);
    expect(container.querySelector("[data-testid='seat-strip']")).not.toBeNull();
    for (const label of ["Card", "Log", "Settings", "Camera"]) {
      const drawer = container.querySelector(`[data-edge-drawer='${label}']`);
      expect(drawer, label).not.toBeNull();
      expect(drawer!.getAttribute("data-state"), `${label} starts closed`).toBe("closed");
    }
    expect(container.querySelector("[data-edge-drawer='Chain']")).toBeNull();
    expect(container.querySelector("[data-edge-drawer='Deck Master']")).toBeNull();
    // No dock and no floating flyout: nothing stands on the field at rest.
    expect(container.querySelector("[data-testid^='hud-dock-']")).toBeNull();
    expect(container.querySelector("[data-testid='hud-flyout']")).toBeNull();
    expect(container.querySelector("[data-testid='table-rail']")).toBeNull();
    expect(container.querySelector("[data-testid='table-drawer']")).toBeNull();
    // The turn controls sit in the bottom-right corner cluster, not in a full-width bottom bar.
    expect(container.querySelector("[data-testid='hud-corner']")).not.toBeNull();
    expect(container.querySelector("[data-testid='hud-bottom']")).toBeNull();
  });

  it("writes turn and prompt status words on the seat strip", () => {
    const { container } = render(<Shell id="main" />);
    const strip = container.querySelector("[data-testid='seat-strip']")!;
    expect(strip.querySelectorAll("li")).toHaveLength(3);
    expect(strip.textContent).toContain("Next");
    expect(strip.textContent).toContain("Choosing");
    expect(strip.textContent).toContain("To play");
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

  it("has the Log pane of the 1v1 duel behind the dock, and no history strip", () => {
    const { container } = render(<Shell id="main" />);
    expect(container.querySelector("[data-testid='history-strip']")).toBeNull();
    const drawer = container.querySelector("[data-edge-drawer='Log']") as HTMLElement;
    fireEvent.click(within(drawer).getByRole("button", { name: /Log/ }));
    expect(drawer.getAttribute("data-state")).toBe("open");
    expect(within(drawer).getByRole("region", { name: "Duel history events" })).toBeTruthy();
  });

  it("lists who may answer an open chain, in order, on the chain panel; no chain, no list", () => {
    const withChain = render(<Shell id="chain-2" />);
    const chips = withChain.container.querySelectorAll("[data-chain-panel] [data-testid='priority-chips'] [data-seat]");
    expect(chips).toHaveLength(3);
    expect(withChain.container.querySelectorAll("[data-chain-panel] [data-now='true']")).toHaveLength(1);
    withChain.unmount();
    const plain = render(<Shell id="main" />);
    expect(plain.container.querySelector("[data-testid='priority-chips']")).toBeNull();
  });

  it("opens every link's details from the chain strip, as the tower has no Chain button", () => {
    render(<Shell id="chain-2" />);
    expect(within(screen.getByTestId("chain-tower")).queryByRole("button", { name: /Chain/ })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Chain details" })).toBeNull();
    fireEvent.click(document.querySelector("[data-chain-strip]") as HTMLElement);
    const sheet = screen.getByRole("dialog", { name: "Chain details" });
    expect(sheet.querySelectorAll("[data-chain-row]")).toHaveLength(2);
  });

  it("puts a Deck Master badge on every holo panel, and the camera panel in the Camera drawer", () => {
    const { container } = render(<Shell id="main" />);
    expect(container.querySelector("[data-docks]")).toBeNull();
    expect(container.querySelector("[data-testid='hud-master']")).toBeNull();
    const badges = [...container.querySelectorAll("[data-testid='dm-badge']")].map((node) => node.getAttribute("data-badge-seat")).sort();
    expect(badges).toEqual(["0", "1", "2"]);
    const drawer = container.querySelector("[data-edge-drawer='Camera']") as HTMLElement;
    act(() => void fireEvent.click(within(drawer).getByRole("button", { name: /Camera/ })));
    expect(drawer.getAttribute("data-state")).toBe("open");
    expect(drawer.querySelector("[data-camera-panel]")).not.toBeNull();
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
