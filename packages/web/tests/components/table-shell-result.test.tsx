// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
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
  vi.useRealTimers();
});

function Shell({ order }: { order?: readonly (readonly number[])[] }) {
  const state = FFA3_FIXTURES.states.result;
  const controller = useFixtureController(state, { reducedMotion: true });
  return <TableShell controller={controller} initialOutOrder={order} />;
}


describe("TableShell result screen", () => {
  it("writes places in words, in the order the duelists left", async () => {
    vi.useFakeTimers();
    render(<Shell order={FFA3_FIXTURES.states.result.ui?.initialOutOrder} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const cells = [...document.querySelectorAll("[data-placings] [data-place]")].map((node) => node.textContent);
    expect(cells).toEqual(["1st", "2nd", "3rd"]);
    const names = [...document.querySelectorAll("[data-placings] li")].map((row) => row.textContent ?? "");
    expect(names[0]).toContain("Ren Arata");
    expect(names[1]).toContain("Ryo Sato");
    expect(names[2]).toContain("Mika Hana");
  });

  it("shares one place between duelists already out when the shell opens", async () => {
    vi.useFakeTimers();
    render(<Shell />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const cells = [...document.querySelectorAll("[data-placings] [data-place]")].map((node) => node.textContent);
    expect(cells).toEqual(["1st", "2nd", "2nd"]);
  });
});
