// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell, type TableShellProps } from "@/components/duel/table/table-shell";

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

function Shell(props: Partial<TableShellProps>) {
  const controller = useFixtureController(FFA3_FIXTURES.states.main, { reducedMotion: true });
  return <TableShell controller={controller} {...props} />;
}

describe("TableShell seams for the room", () => {
  it("shows the header tools and the modals the room passes", () => {
    const { container } = render(<Shell headerTools={<button type="button">Surrender</button>} modals={<div data-testid="room-modal" />} />);
    expect(container.querySelector("header")?.textContent).toContain("Surrender");
    expect(container.querySelector("[data-testid='room-modal']")).not.toBeNull();
  });

  it("offers the phase moves until the room says it is busy", () => {
    const open = render(<Shell />);
    expect(open.container.querySelector("button[aria-label='Battle Phase']")).not.toBeNull();
    open.unmount();
    const busy = render(<Shell busy />);
    expect(busy.container.querySelector("button[aria-label='Battle Phase']")).toBeNull();
  });
});
