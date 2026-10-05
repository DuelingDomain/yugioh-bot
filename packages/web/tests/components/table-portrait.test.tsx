// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";

beforeEach(() => {
  vi.useFakeTimers();
  class RO { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(378);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(650);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const [width, height] = this.hasAttribute("data-chain-strip-wrap") ? [300, 88]
      : this.hasAttribute("data-prompt-panel") ? [366, 160]
      : this.hasAttribute("data-chain-front") || this.hasAttribute("data-chain-fx") ? [378, 650] : [0, 0];
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function Shell({ fixture }: { fixture: TableFixtureState }) {
  const controller = useFixtureController(fixture, { reducedMotion: true });
  return <TableShell controller={controller} />;
}

describe("phone chain and response rows", () => {
  it.each([FFA3_FIXTURES])("fits $format between the measured chain and response without losing seats or phases", async (set) => {
    const { container } = render(<Shell fixture={set.states["chain-2"]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const stage = container.querySelector<HTMLElement>("[data-table-stage]")!;
    expect(stage.dataset.portrait).toBe("true");
    expect(stage.dataset.chainRoom).toBe("6,48,300,88");
    // 650px stage minus seat controls (44), chain row (100), response (168) and status (40).
    const available = 298;
    const fittedHeight = Number(stage.dataset.stageScale) * (set.format === "ffa4" ? 1180 : 1000);
    expect(fittedHeight).toBeGreaterThan(available - 2);
    expect(fittedHeight).toBeLessThan(available + 2);
    expect(container.querySelectorAll("[data-seat-field]")).toHaveLength(set.states.main.room.engine!.seats.length);
    expect(container.querySelectorAll("[data-hand-seat]")).toHaveLength(set.states.main.room.engine!.seats.length);
    expect(container.querySelector('nav[aria-label="Duel phases"]')).not.toBeNull();
  });

  // The 4-way table is the 2 by 2 grid on every screen: it has no portrait plaza and no chain room, but it keeps all four
  // fields, all four hands and the phases while a chain is open on a phone.
  it("keeps all four seats and the phases of the 4-way grid on a phone with a chain open", async () => {
    const { container } = render(<Shell fixture={FFA4_FIXTURES.states["chain-2"]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const stage = container.querySelector<HTMLElement>("[data-table-stage]")!;
    expect(stage.hasAttribute("data-grid-stage")).toBe(true);
    expect(stage.dataset.portrait).toBeUndefined();
    const seats = FFA4_FIXTURES.states.main.room.engine!.seats.length;
    expect(container.querySelectorAll("[data-seat-field]")).toHaveLength(seats);
    expect(container.querySelectorAll("[data-hand-seat]")).toHaveLength(seats);
    expect(container.querySelector('nav[aria-label="Duel phases"]')).not.toBeNull();
  });
});
