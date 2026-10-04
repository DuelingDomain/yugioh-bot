// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelMasterRule } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelField } from "@/components/duel/field";
import { LOCATION_MZONE, LOCATION_PZONE, LOCATION_SZONE, zoneKey } from "@/components/duel/constants";
import { applyEdits } from "@/components/duel/fx-lab/board";
import { findScenario } from "@/components/duel/fx-lab/scenarios";

afterEach(cleanup);

/** Rules 2 and 4 draw the lab board of the nearest rule that has the same zones (1 and 5). */
const LAB_BOARD: Record<DuelMasterRule, 1 | 3 | 5> = { 1: 1, 2: 1, 3: 3, 4: 5, 5: 5 };

function field(rule: DuelMasterRule, legal: string[] = []) {
  const script = findScenario(`state-field-mr${LAB_BOARD[rule]}`)!.build();
  const engine = {
    revision: 1, turn: 1, turnSeat: 0, phase: "main1", battleStep: null,
    seats: script.initial.seats, prompt: null, chain: [], events: [], log: [], result: null,
  };
  return render(
    <DuelField engine={engine} mySeat={0} masterRule={rule} reducedMotion
      legalKeys={new Set(legal)} selectedKeys={new Set()}
      onActivate={() => {}} onInspect={() => {}} bottomName="You" topName="Opp" />,
  );
}

const emzZones = (container: HTMLElement) => container.querySelectorAll('[data-kind="emz"]');

describe("DuelField Extra Monster Zones by Master Rule", () => {
  it.each([4, 5] as const)("draws both Extra Monster Zones under Master Rule %i", (rule) => {
    const { container } = field(rule, [zoneKey(0, LOCATION_MZONE, 6)]);
    expect(container.querySelector("[data-duel-field]")?.getAttribute("data-master-rule")).toBe(String(rule));
    expect(emzZones(container)).toHaveLength(2);
    // The Link monsters of the lab board sit in the shared zones, and a legal key lights its zone.
    expect(container.querySelector('[data-kind="emz"][data-occupied="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-kind="emz"][data-legal="true"]')).toHaveLength(1);
  });

  it.each([1, 2, 3] as const)("draws no Extra Monster Zone under Master Rule %i", (rule) => {
    const { container } = field(rule, [zoneKey(0, LOCATION_MZONE, 5), zoneKey(0, LOCATION_MZONE, 6)]);
    expect(container.querySelector("[data-duel-field]")?.getAttribute("data-master-rule")).toBe(String(rule));
    expect(emzZones(container)).toHaveLength(0);
    expect(container.querySelector('[data-zones~="0:4:5"], [data-zones~="0:4:6"]')).toBeNull();
    expect(container.textContent).not.toContain("Extra Monster");
    // The five monster zones of each side are still there.
    expect(container.querySelectorAll(`[data-zones~="0:${LOCATION_MZONE}:0"]`)).toHaveLength(1);
  });
});

describe("DuelField Pendulum Zones by Master Rule", () => {
  it("has no Pendulum Zone under Master Rule 1 and 2", () => {
    for (const rule of [1, 2] as const) {
      const { container } = field(rule);
      expect(container.querySelectorAll('[data-kind="st"]')).toHaveLength(10);
      expect(container.querySelector(`[data-zones~="0:${LOCATION_PZONE}:0"]`)).toBeNull();
      expect(container.querySelector(`[data-zones~="0:${LOCATION_PZONE}:1"]`)).toBeNull();
      cleanup();
    }
  });

  it("puts the Pendulum Zones beside the field (Spell/Trap sequences 6 and 7) under Master Rule 3", () => {
    const { container } = field(3);
    expect(container.querySelectorAll('[data-kind="st"]')).toHaveLength(14);
    expect(container.querySelector(`[data-zones~="0:${LOCATION_SZONE}:6"]`)?.getAttribute("data-zones")).toContain(`0:${LOCATION_PZONE}:0`);
    expect(container.querySelector(`[data-zones~="0:${LOCATION_SZONE}:7"]`)?.getAttribute("data-zones")).toContain(`0:${LOCATION_PZONE}:1`);
    // The outer Spell/Trap Zones are plain zones.
    expect(container.querySelector(`[data-zones~="0:${LOCATION_SZONE}:0"]`)?.getAttribute("data-zones")).not.toContain(`:${LOCATION_PZONE}:`);
    expect(container.querySelector(`[data-zones~="0:${LOCATION_SZONE}:4"]`)?.getAttribute("data-zones")).not.toContain(`:${LOCATION_PZONE}:`);
  });

  it("uses the outer Spell/Trap Zones as Pendulum Zones under Master Rule 4 and 5", () => {
    for (const rule of [4, 5] as const) {
      const { container } = field(rule);
      expect(container.querySelectorAll('[data-kind="st"]')).toHaveLength(10);
      expect(container.querySelector(`[data-zones~="0:${LOCATION_SZONE}:0"]`)?.getAttribute("data-zones")).toContain(`0:${LOCATION_PZONE}:0`);
      expect(container.querySelector(`[data-zones~="0:${LOCATION_SZONE}:4"]`)?.getAttribute("data-zones")).toContain(`0:${LOCATION_PZONE}:1`);
      cleanup();
    }
  });
});

describe("fx lab Master Rule field scenarios", () => {
  it("draw the board for the rule they name, with Link monsters only where the zones exist", () => {
    for (const rule of [1, 3, 5] as const) {
      const script = findScenario(`state-field-mr${rule}`)!.build();
      expect(script.masterRule).toBe(rule);
      const board = applyEdits(script.initial, []);
      const inEmz = board.seats.some((seat) => seat.monsters.slice(5).some((card) => card != null));
      expect(inEmz).toBe(rule >= 4);
    }
  });
});

describe("DuelField phase hub slot", () => {
  function withHub(rule: DuelMasterRule, hub: React.ReactNode) {
    const script = findScenario(`state-field-mr${LAB_BOARD[rule]}`)!.build();
    const engine = {
      revision: 1, turn: 1, turnSeat: 0, phase: "main1", battleStep: null,
      seats: script.initial.seats, prompt: null, chain: [], events: [], log: [], result: null,
    };
    return render(
      <DuelField engine={engine} mySeat={0} masterRule={rule} reducedMotion
        legalKeys={new Set()} selectedKeys={new Set()} hub={hub}
        onActivate={() => {}} onInspect={() => {}} bottomName="You" topName="Opp" />,
    );
  }

  it.each([1, 3, 5] as const)("draws the hub lane between the two fields, under the Extra Monster Zones, under Master Rule %i", (rule) => {
    const { container } = withHub(rule, <nav aria-label="Duel phases" data-testid="hub-probe" />);
    const hub = container.querySelector('[data-testid="hub-probe"]')!;
    const halves = [...container.querySelectorAll("[data-field-seat]")];
    expect(halves).toHaveLength(2);
    // After the top field and before the bottom one in document order: the band between them.
    expect(halves[0].compareDocumentPosition(hub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hub.compareDocumentPosition(halves[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(halves.some((half) => half.contains(hub))).toBe(false);
    // The lane belongs to the board's middle row and the playmat knows to reserve its height.
    expect(hub.closest("[data-hub='true']")).not.toBeNull();
    // After the Extra Monster Zones in document order, as it is on screen.
    for (const emz of container.querySelectorAll('[data-kind="emz"]')) {
      expect(emz.compareDocumentPosition(hub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("reserves no lane without a hub", () => {
    const { container } = field(5);
    expect(container.querySelector("[data-hub='true']")).toBeNull();
  });

  it("leaves both Extra Monster Zones in place beside the hub", () => {
    const { container } = withHub(5, <nav aria-label="Duel phases" />);
    expect(container.querySelectorAll('[data-kind="emz"]')).toHaveLength(2);
  });

  it("draws nothing extra without a hub", () => {
    const { container } = field(5);
    expect(container.querySelector('nav[aria-label="Duel phases"]')).toBeNull();
  });
});
