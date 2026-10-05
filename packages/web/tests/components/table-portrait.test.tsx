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
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { TagShell } from "@/components/duel/tag/tag-shell";
import { TableShell } from "@/components/duel/table/table-shell";

let stripHeight = 88;
beforeEach(() => {
  stripHeight = 88;
  vi.useFakeTimers();
  class RO { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(378);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(650);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const [width, height] = this.hasAttribute("data-chain-strip-wrap") ? [300, stripHeight]
      : this.hasAttribute("data-prompt-panel") ? [366, 160]
      : this.hasAttribute("data-chain-front") || this.hasAttribute("data-chain-fx") ? [378, 650] : [0, 0];
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function Shell({ fixture, tag = false }: { fixture: TableFixtureState; tag?: boolean }) {
  const controller = useFixtureController(fixture, { reducedMotion: true });
  return tag ? <TagShell controller={controller} /> : <TableShell controller={controller} />;
}

describe("phone chain and response rows", () => {
  it.each([FFA3_FIXTURES, FFA4_FIXTURES])("fits $format between the measured chain and response without losing seats or phases", async (set) => {
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
});


describe("Tag phone chain room", () => {
  it("leaves desktop unreserved and releases the band on resize", async () => {
    vi.stubGlobal("innerWidth", 1440);
    const { container } = render(<Shell fixture={TAG_FIXTURES.states["chain-2"]} tag />);
    const stage = container.querySelector<HTMLElement>("[data-tag-stage]")!;
    const viewport = stage.querySelector<HTMLElement>("[data-tag-viewport]")!;
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(stage.dataset.chainRoom).toBeUndefined();
    expect(viewport.style.top).toBe("0px");
    vi.stubGlobal("innerWidth", 390);
    act(() => { window.dispatchEvent(new Event("resize")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(stage.dataset.chainRoom).toBe("6,4,300,88");
    expect(viewport.style.top).toBe("100px");
    vi.stubGlobal("innerWidth", 1440);
    act(() => { window.dispatchEvent(new Event("resize")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(stage.dataset.chainRoom).toBeUndefined();
    expect(viewport.style.top).toBe("0px");
  });

  it.each([88, 124])("reserves a %ipx strip above the viewport containing plates, boards, hands and prompt", async (height) => {
    stripHeight = height;
    const { container } = render(<Shell fixture={TAG_FIXTURES.states["chain-2"]} tag />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const stage = container.querySelector<HTMLElement>("[data-tag-stage]")!;
    expect(stage.dataset.chainRoom).toBe(`6,4,300,${height}`);
    const viewport = stage.querySelector<HTMLElement>("[data-tag-viewport]")!;
    expect(viewport.style.top).toBe(`${height + 12}px`);
    for (const selector of ["[data-team-plate]", "[data-seat-field]", "[data-hand-seat]", "[data-prompt-panel]"]) {
      const protectedContent = [...stage.querySelectorAll(selector)];
      expect(protectedContent.length).toBeGreaterThan(0);
      expect(protectedContent.every((node) => viewport.contains(node))).toBe(true);
    }
    const front = container.querySelector<HTMLElement>("[data-chain-front]")!;
    expect(front.dataset.roomReady).toBe("true");
    expect(front.style.getPropertyValue("--chain-dock-top")).toBe("4px");
  });
});
