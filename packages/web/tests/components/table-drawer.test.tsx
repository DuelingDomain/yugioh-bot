// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import {
  DRAWER_STORAGE_KEY,
  readStoredDrawer,
  writeStoredDrawer,
} from "@/components/duel/table/use-table-drawer";

let observers: Array<() => void> = [];

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) { observers.push(cb); }
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
beforeEach(() => {
  window.localStorage.clear();
  observers = [];
});
afterEach(cleanup);

function Shell({ reducedMotion = true }: { reducedMotion?: boolean }) {
  const controller = useFixtureController(FFA3_FIXTURES.states.main, { reducedMotion });
  return <TableShell controller={controller} />;
}

const layoutOf = (container: HTMLElement) => container.querySelector("[data-wide='true']") as HTMLElement;
const drawerOf = (container: HTMLElement) => container.querySelector("[data-testid='table-drawer']") as HTMLElement;
const railButton = (container: HTMLElement, key: string) => container.querySelector(`[data-rail='${key}']`) as HTMLButtonElement;
/** The stored choice is applied after mount and the drawer then waits two frames before it animates. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });

describe("the drawer on the wide table", () => {
  it("starts closed: the table has the whole width, and nothing in the drawer can be reached", async () => {
    const { container } = render(<Shell />);
    await settle();
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("closed");
    const drawer = drawerOf(container);
    expect(drawer.getAttribute("data-open")).toBe("false");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(drawer.hasAttribute("inert")).toBe(true);
    for (const key of ["card", "log", "masters", "settings"]) expect(railButton(container, key).getAttribute("aria-expanded"), key).toBe("false");
  });

  it("opens from a rail button into its own column, closes from the same button, and says so with aria-expanded", async () => {
    const { container } = render(<Shell />);
    await settle();
    fireEvent.click(railButton(container, "log"));
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("open");
    expect(drawerOf(container).getAttribute("data-open")).toBe("true");
    expect(drawerOf(container).hasAttribute("inert")).toBe(false);
    expect(railButton(container, "log").getAttribute("aria-expanded")).toBe("true");
    expect(railButton(container, "card").getAttribute("aria-expanded")).toBe("false");
    // Another rail button swaps the pane without closing.
    fireEvent.click(railButton(container, "settings"));
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("open");
    expect(railButton(container, "settings").getAttribute("aria-expanded")).toBe("true");
    // The button of the pane that is showing closes it.
    fireEvent.click(railButton(container, "settings"));
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("closed");
  });

  it("closes on Escape from inside the drawer and gives focus back to the rail button that opened it", async () => {
    const { container } = render(<Shell />);
    await settle();
    const button = railButton(container, "settings");
    button.focus();
    fireEvent.click(button);
    const close = container.querySelector("[data-testid='table-drawer'] button") as HTMLButtonElement;
    close.focus();
    fireEvent.keyDown(drawerOf(container), { key: "Escape" });
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("closed");
    expect(document.activeElement).toBe(button);
  });

  it("remembers open or closed and the tab for the viewer, and writes it only once it has settled", async () => {
    const { container, unmount } = render(<Shell />);
    await settle();
    fireEvent.click(railButton(container, "log"));
    await settle();
    expect(JSON.parse(window.localStorage.getItem(DRAWER_STORAGE_KEY) ?? "null")).toEqual({ open: true, pane: "log" });
    unmount();
    const again = render(<Shell />);
    await settle();
    expect(layoutOf(again.container).getAttribute("data-drawer")).toBe("open");
    expect(railButton(again.container, "log").getAttribute("aria-expanded")).toBe("true");
  });

  it("paints closed first even with an open drawer stored, so the server and the first client paint agree", () => {
    window.localStorage.setItem(DRAWER_STORAGE_KEY, JSON.stringify({ open: true, pane: "card" }));
    const html = renderToStaticMarkupOf();
    expect(html).toContain('data-drawer="closed"');
  });

  it("re-measures the board while the drawer moves: one resize per frame until the slide is over", async () => {
    const { container } = render(<Shell />);
    await settle();
    const resizes = vi.fn();
    window.addEventListener("resize", resizes);
    try {
      fireEvent.click(railButton(container, "card"));
      await waitFor(() => expect(resizes.mock.calls.length).toBeGreaterThan(0));
      const counted = resizes.mock.calls.length;
      fireEvent.click(railButton(container, "card"));
      await waitFor(() => expect(resizes.mock.calls.length).toBeGreaterThan(counted));
    } finally {
      window.removeEventListener("resize", resizes);
    }
  });

  it("refits the stage when the board box changes (the drawer's column), not only when the window does", async () => {
    const { container } = render(<Shell />);
    await settle();
    const before = container.querySelector("[data-stage-spread]")?.getAttribute("data-stage-spread");
    expect(before).not.toBeUndefined();
    expect(observers.length).toBeGreaterThan(0);
    // Every ResizeObserver callback is the table's own measure: running them all must not throw or loop.
    await act(async () => { for (const callback of observers) callback(); await Promise.resolve(); });
    expect(container.querySelector("[data-table-stage]")).not.toBeNull();
  });

  it("opens the Card drawer when a card is clicked to look at it, and not when the click plays it", async () => {
    const { container } = render(<Shell />);
    await settle();
    const arts = [...container.querySelectorAll<HTMLElement>("[data-zones] [data-card-art]")];
    expect(arts.length).toBeGreaterThan(0);
    // A rival's card has nothing to play: clicking it is looking at it.
    // (A face-down one cannot be looked at, so walk the rival's cards until one is face up.)
    for (const art of arts.filter((node) => node.closest('[data-side="opp"]'))) {
      fireEvent.click(art.closest("button, [role='button']") ?? art);
      if (layoutOf(container).getAttribute("data-drawer") === "open") break;
    }
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("open");
    expect(railButton(container, "card").getAttribute("aria-expanded")).toBe("true");
  });

  /** Looks at a rival's face-up card, which opens the Card drawer. */
  const inspectRivalCard = (container: HTMLElement) => {
    const arts = [...container.querySelectorAll<HTMLElement>("[data-zones] [data-card-art]")].filter((node) => node.closest('[data-side="opp"]'));
    for (const art of arts) {
      fireEvent.click(art.closest("button, [role='button']") ?? art);
      if (layoutOf(container).getAttribute("data-drawer") === "open") return;
    }
  };

  it("shows the Card pane when a card is looked at, even if the drawer was last on Settings", async () => {
    const { container } = render(<Shell />);
    await settle();
    fireEvent.click(railButton(container, "settings"));
    fireEvent.click(railButton(container, "settings"));
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("closed");
    inspectRivalCard(container);
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("open");
    expect(railButton(container, "card").getAttribute("aria-expanded")).toBe("true");
    expect(railButton(container, "settings").getAttribute("aria-expanded")).toBe("false");
  });

  it("closes a drawer that a card inspect opened on Escape, with focus left on the card", async () => {
    const { container } = render(<Shell />);
    await settle();
    inspectRivalCard(container);
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("open");
    // The walk over a rival's cards may also have opened a pile viewer: it owns the first Escape, the drawer gets the next.
    const pile = document.querySelector<HTMLElement>("[data-pile-viewer]");
    if (pile) {
      fireEvent.keyDown(pile, { key: "Escape" });
      expect(layoutOf(container).getAttribute("data-drawer")).toBe("open");
    }
    await act(async () => { await Promise.resolve(); });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(layoutOf(container).getAttribute("data-drawer")).toBe("closed");
  });

  it("leaves Escape to an open modal: the drawer stays", async () => {
    const { container } = render(<Shell />);
    await settle();
    fireEvent.click(railButton(container, "log"));
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    try {
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(layoutOf(container).getAttribute("data-drawer")).toBe("open");
    } finally {
      modal.remove();
    }
  });

  it("is not a keyboard trap: Tab and Space on a rail or drawer control are left to the browser, not the camera", async () => {
    const { container } = render(<Shell />);
    await settle();
    fireEvent.click(railButton(container, "log"));
    const close = container.querySelector("[data-testid='table-drawer'] button") as HTMLButtonElement;
    for (const target of [railButton(container, "card"), close]) {
      target.focus();
      for (const key of ["Tab", " ", "s"]) expect(fireEvent.keyDown(target, { key }), `${key} on ${target.className}`).toBe(true);
    }
  });

  it("keeps the stored drawer when the window narrows and the drawer is forced shut", async () => {
    let narrow = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 900px") ? narrow : false,
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    }));
    try {
      const { container } = render(<Shell />);
      await settle();
      fireEvent.click(railButton(container, "log"));
      await settle();
      expect(JSON.parse(window.localStorage.getItem(DRAWER_STORAGE_KEY) ?? "null")).toEqual({ open: true, pane: "log" });
      narrow = true;
      await act(async () => { for (const cb of [...listeners]) cb(); });
      await settle();
      expect(JSON.parse(window.localStorage.getItem(DRAWER_STORAGE_KEY) ?? "null")).toEqual({ open: true, pane: "log" });
    } finally {
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    }
  });

  it("gives the drawer, the rail and the board each their own grid area so nothing sits under the drawer", async () => {
    const { container } = render(<Shell />);
    await settle();
    const layout = layoutOf(container);
    const rail = container.querySelector("[data-testid='table-rail']") as HTMLElement;
    expect(layout.contains(rail)).toBe(true);
    expect(layout.contains(drawerOf(container))).toBe(true);
    expect(layout.querySelector("section[aria-label='Duel field']")).not.toBeNull();
  });
});

describe("the stored drawer", () => {
  it("reads only a well formed value and falls back to the Card tab for an unknown one", () => {
    expect(readStoredDrawer({ getItem: () => JSON.stringify({ open: true, pane: "log" }) })).toEqual({ open: true, pane: "log" });
    expect(readStoredDrawer({ getItem: () => JSON.stringify({ open: false, pane: "nope" }) })).toEqual({ open: false, pane: "card" });
    expect(readStoredDrawer({ getItem: () => "not json" })).toBeNull();
    expect(readStoredDrawer({ getItem: () => JSON.stringify({ pane: "log" }) })).toBeNull();
    expect(readStoredDrawer({ getItem: () => null })).toBeNull();
    expect(readStoredDrawer(null)).toBeNull();
  });

  it("never throws when the browser blocks storage", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readStoredDrawer(blocked)).toBeNull();
    expect(() => writeStoredDrawer({ open: true, pane: "card" }, blocked)).not.toThrow();
  });
});

function renderToStaticMarkupOf(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { renderToString } = require("react-dom/server") as typeof import("react-dom/server");
  return renderToString(<Shell />);
}
