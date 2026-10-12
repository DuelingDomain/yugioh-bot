// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES, ffa3Variant } from "@/components/duel/table/fixtures/ffa3";
import { TABLE_CARDS as C, type TableFixtureState } from "@/components/duel/table/fixtures/common";
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

function Shell({ state }: { state: TableFixtureState }) {
  const controller = useFixtureController(state, { reducedMotion: true });
  return <TableShell controller={controller} />;
}

const paired = ffa3Variant(FFA3_FIXTURES, { out: [], pair: true });
const asSeat = (state: TableFixtureState, seat: number): TableFixtureState => ({ ...state, room: { ...state.room, mySeat: seat } }) as TableFixtureState;

describe("the 3-way plaza marks the facing pair 0 and 1", () => {
  it("keeps the plaza (no grid) and marks the pair 0 and 1 (tint, plate badges) for the viewer, a rival and a spectator", () => {
    for (const state of [paired.states.main, asSeat(paired.states.main, 2), paired.states.spectator]) {
      const { container, unmount } = render(<Shell state={state} />);
      expect(container.querySelector("[data-grid-stage]")).toBeNull();
      expect(container.querySelector("[data-pair-link]")).toBeNull();
      expect(container.querySelector("[data-emz-pair]")!.getAttribute("data-emz-pair")).toBe("0-1");
      // One chain badge on each plate of the pair, naming the other seat; seat 2 has none.
      const badges = [...container.querySelectorAll("[data-pair-badge]")].map((node) => node.getAttribute("aria-label"));
      expect(badges).toHaveLength(2);
      expect(badges.every((label) => /^Shares Extra Monster Zones and columns with \S/.test(label ?? ""))).toBe(true);
      // Both Extra Monster Zones of the two seats say they are linked; seat 2 shares nothing.
      expect(container.querySelectorAll('[data-testid="seat-field-0"] [data-link]')).toHaveLength(2);
      expect(container.querySelectorAll('[data-testid="seat-field-1"] [data-link]')).toHaveLength(2);
      expect(container.querySelectorAll('[data-testid="seat-field-2"] [data-link]')).toHaveLength(0);
      unmount();
    }
  });

  it("shows no link on an older core without sharedExtraWith, or when one seat of the pair is out", () => {
    const plain = render(<Shell state={FFA3_FIXTURES.states.main} />);
    expect(plain.container.querySelector("[data-emz-pair]")).toBeNull();
    expect(plain.container.querySelector("[data-pair-badge]")).toBeNull();
    expect(plain.container.querySelector("[data-link]")).toBeNull();
    plain.unmount();
    const out = ffa3Variant(FFA3_FIXTURES, { out: [1], pair: true });
    const dead = render(<Shell state={out.states.main} />);
    expect(dead.container.querySelector("[data-emz-pair]")).toBeNull();
    expect(dead.container.querySelector("[data-pair-badge]")).toBeNull();
    expect(dead.container.querySelector("[data-link]")).toBeNull();
  });

  it("shows a monster of seat 0 in the shared zone as a taken ghost on the mirrored zone of seat 1", () => {
    // The fixture already holds Jinzo in zone 5 of seat 0.
    const state = paired.states.main;
    expect(state.room.engine!.seats[0].monsters[5]?.name).toBe(C.jinzo.name);
    const { container } = render(<Shell state={state} />);
    // Zone 5 of seat 0 is zone 6 of seat 1: seat 0 owns the card, seat 1 sees the zone taken.
    const own = container.querySelector('[data-testid="seat-field-0"] [data-link-seq="5"]')!;
    const taken = container.querySelector('[data-testid="seat-field-1"] [data-link-seq="6"]')!;
    expect(own.getAttribute("data-link")).toBe("shared");
    expect(taken.getAttribute("data-link")).toBe("taken");
    expect(taken.getAttribute("data-zones")).toBe("");
    expect(taken.querySelector("button")?.getAttribute("aria-label") ?? taken.textContent).toMatch(/shared with|taken/i);
    // The other zone of seat 1 stays free.
    expect(container.querySelector('[data-testid="seat-field-1"] [data-link-seq="5"]')!.getAttribute("data-link")).toBe("shared");
  });

  it("never acts on a ghost: a click on it sends no answer and opens no card menu, while the owner's own zone still answers", () => {
    const base = paired.states.main;
    const engine = base.room.engine!;
    const jinzo = engine.seats[0].monsters[5]!;
    const prompt = {
      id: "pick-jinzo",
      seat: 0,
      kind: "cards",
      title: "Select a monster",
      min: 1,
      max: 1,
      options: [{ id: "jinzo", label: "Jinzo", card: jinzo, controller: 0, location: jinzo.location, sequence: 5 }],
    };
    const state = { ...base, room: { ...base.room, engine: { ...engine, prompt } } } as unknown as TableFixtureState;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const { container } = render(<Shell state={state} />);
      const answers = () => info.mock.calls.filter((call) => call[0] === "[table-preview] answer").length;
      fireEvent.click(container.querySelector('[data-testid="seat-field-1"] [data-link-seq="6"] button')!);
      expect(answers()).toBe(0);
      expect(screen.queryByRole("menu")).toBeNull();
      fireEvent.click(container.querySelector('[data-testid="seat-field-0"] [data-link-seq="5"] button')!);
      expect(answers()).toBe(1);
    } finally {
      info.mockRestore();
    }
  });
});
