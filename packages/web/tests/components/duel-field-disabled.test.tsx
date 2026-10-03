// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelField } from "@/components/duel/field";
import { MultiSeatStage } from "@/components/duel/multi-seat-stage";

afterEach(cleanup);

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [], ...extra,
  };
}

function engineOf(count: number, seatExtra: Record<number, Partial<DuelSeatView>>, format: DuelEngineView["format"] = "1v1"): DuelEngineView {
  return {
    revision: 1, format, turn: 1, turnSeat: 0, phase: "main1",
    seats: Array.from({ length: count }, (_, seat) => seatView(seat, seatExtra[seat])),
    prompt: null, chain: [], events: [], log: [], result: null,
  };
}

function field(engine: DuelEngineView) {
  return render(
    <DuelField engine={engine} mySeat={0} masterRule={4} reducedMotion legalKeys={new Set()} selectedKeys={new Set()}
      onActivate={vi.fn()} onInspect={vi.fn()} bottomName="Ada" topName="Bo" />,
  );
}

describe("DuelField disabled zones (1v1)", () => {
  it("draws the disabled zones of both sides once, with labels", () => {
    const mask0 = (1 << 0) | (1 << 5) | (1 << 9) | (1 << 13);
    const mask1 = (1 << 2) | (1 << 5) | (1 << 8);
    field(engineOf(2, { 0: { disabledZones: mask0 }, 1: { disabledZones: mask1 } }));
    expect(screen.getByTestId("zone-disabled-0-m-0").getAttribute("aria-label")).toBe("Monster zone 1 (disabled)");
    expect(screen.getByTestId("zone-disabled-0-s-1").getAttribute("aria-label")).toBe("Spell and Trap zone 2 (disabled)");
    expect(screen.getByTestId("zone-disabled-0-f-0").getAttribute("aria-label")).toBe("Your Field Spell (disabled)");
    expect(screen.getByTestId("zone-disabled-0-m-5").getAttribute("aria-label")).toBe("Extra monster zone, column 2 (disabled)");
    expect(screen.getByTestId("zone-disabled-1-m-2").getAttribute("aria-label")).toBe("Monster zone 3 (disabled)");
    expect(screen.getByTestId("zone-disabled-1-s-0")).toBeTruthy();
    // Top seat bit 5 is the right Extra Monster Zone.
    expect(screen.getByTestId("zone-disabled-1-m-5").getAttribute("aria-label")).toBe("Extra monster zone, column 4 (disabled)");
    expect(document.querySelectorAll('[data-testid^="zone-disabled-"]')).toHaveLength(7);
  });

  it("draws one marker when both sides disable the same mirrored Extra Monster Zone", () => {
    field(engineOf(2, { 0: { disabledZones: 1 << 5 }, 1: { disabledZones: 1 << 6 } }));
    expect(document.querySelectorAll('[data-testid^="zone-disabled-"]')).toHaveLength(1);
    expect(screen.getByTestId("zone-disabled-0-m-5")).toBeTruthy();
  });

  it("draws nothing without a mask", () => {
    field(engineOf(2, {}));
    expect(document.querySelectorAll('[data-testid^="zone-disabled-"]')).toHaveLength(0);
  });
});

describe("DuelField disabled zones (3 seats)", () => {
  it("does not draw the focused opponent's Extra Monster Zones in the field band", () => {
    const engine = engineOf(3, { 0: { disabledZones: 1 << 6 }, 1: { disabledZones: (1 << 5) | (1 << 6) | (1 << 1) } }, "ffa3");
    render(
      <MultiSeatStage engine={engine} mySeat={0} masterRule={4} reducedMotion legalKeys={new Set()} selectedKeys={new Set()}
        onActivate={vi.fn()} onInspect={vi.fn()} nameOf={(seat) => ["Ada", "Bo", "Cy"][seat]} promptSeat={null}
        focusSeat={1} onFocusSeat={vi.fn()} />,
    );
    const field = screen.getByTestId("seat-field");
    expect(field.querySelector('[data-testid="zone-disabled-0-m-6"]')).toBeTruthy();
    expect(field.querySelector('[data-testid="zone-disabled-1-m-1"]')).toBeTruthy();
    expect(field.querySelector('[data-testid="zone-disabled-1-m-5"]')).toBeNull();
    expect(field.querySelector('[data-testid="zone-disabled-1-m-6"]')).toBeNull();
  });
});
