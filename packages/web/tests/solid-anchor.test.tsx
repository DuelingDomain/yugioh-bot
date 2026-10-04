// @vitest-environment jsdom
// The 3D mode table (SolidField) must expose the same hooks as the classic table (DuelField): the FX layers, the
// prompt layer and the e2e tests anchor on them. It must also keep the classic zone keys, hand and pile hooks.
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import { DuelField } from "@/components/duel/field";
import { SolidField } from "@/components/duel/solid/solid-field";
import { solidEngine } from "./helpers/solid-board";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function props(engine: DuelEngineView, masterRule: 3 | 4 | 5 = 5, mySeat: number | null = 0) {
  return {
    engine, mySeat, masterRule, reducedMotion: false, priorityLive: true,
    legalKeys: new Set(["0-2-0", "0-4-1"]), selectedKeys: new Set(["0-2-5"]),
    onActivate: () => {}, onInspect: () => {}, bottomName: "Yugi", topName: "Kaiba",
  };
}

const attr = (root: ParentNode, name: string, extra = "") =>
  [...root.querySelectorAll(`[${name}]${extra}`)].map((el) => el.getAttribute(name)).sort();

/** Zone tokens with state hooks, as the FX layers read them. */
function zoneHooks(root: ParentNode): string[] {
  return [...root.querySelectorAll("[data-zones]")].map((el) =>
    [el.getAttribute("data-zones"), el.getAttribute("data-kind"), el.getAttribute("data-legal"), el.getAttribute("data-selected"),
      el.getAttribute("data-occupied"), el.getAttribute("data-side")].join("|")).sort();
}

function hooks(root: ParentNode) {
  return {
    zones: zoneHooks(root),
    handSeats: attr(root, "data-hand-seat"),
    handIds: attr(root, "data-hand-id"),
    handCards: root.querySelectorAll("[data-hand-card]").length,
    probes: root.querySelectorAll("[data-hand-size-probe]").length,
    lp: attr(root, "data-lp-seat"),
    art: root.querySelectorAll("[data-card-art]").length,
    pileCounts: attr(root, "data-pile-count"),
    masterDocks: root.querySelectorAll("[data-master-dock]").length,
  };
}

describe("SolidField anchors", () => {
  it.each([
    ["Master Rule 5", 5],
    ["Master Rule 4", 4],
  ] as const)("keeps the classic hooks (%s)", (_name, masterRule) => {
    const engine = solidEngine({ domain: true });
    const classic = render(<DuelField {...props(engine, masterRule)} />);
    const before = hooks(classic.container);
    cleanup();
    const solid = render(<SolidField {...props(engine, masterRule)} />);
    const after = hooks(solid.container);
    expect(after.zones.length).toBeGreaterThan(20);
    expect(after).toEqual(before);
  });

  it("puts the root hooks on one untilted element", () => {
    const { container } = render(<SolidField {...props(solidEngine())} />);
    const roots = container.querySelectorAll("[data-duel-field]");
    expect(roots).toHaveLength(1);
    const root = roots[0] as HTMLElement;
    expect(root.getAttribute("data-battle")).toBe("false");
    expect(root.getAttribute("data-reduced-motion")).toBe("false");
    expect(root.getAttribute("data-master-rule")).toBe("5");
    // Only the plane is tilted: nothing between the root and the plane carries the plane hook.
    expect(container.querySelectorAll("[data-sv-plane]")).toHaveLength(1);
    expect(root.closest("[data-sv-plane]")).toBeNull();
  });

  it("marks each half with its seat, side, turn and priority", () => {
    const { container } = render(<SolidField {...props(solidEngine({ turnSeat: 1 }))} />);
    const halves = [...container.querySelectorAll("[data-field-seat]")];
    expect(halves.map((el) => [el.getAttribute("data-field-seat"), el.getAttribute("data-side")])).toEqual([["1", "top"], ["0", "bottom"]]);
    expect(halves[0].getAttribute("data-turn")).toBe("true");
    expect(halves[1].getAttribute("data-turn")).toBe("false");
    expect(container.querySelector("[data-sv-plane]")?.getAttribute("data-light")).toBe("opp");
  });

  it("places the zones on the 7x5 grid", () => {
    const { container } = render(<SolidField {...props(solidEngine())} />);
    const cells = [...container.querySelectorAll<HTMLElement>("[data-cell]")];
    const at = (col: number, row: number) => cells.filter((el) => el.style.gridColumn.startsWith(`${col}`) && el.style.gridRow.startsWith(`${row}`));
    // 7 columns by 5 rows minus the clock gaps (they are not cells): 35 grid squares, EMZ columns 3 and 5 of the band.
    expect(at(3, 3)[0]?.getAttribute("data-cell")).toBe("emz");
    expect(at(5, 3)[0]?.getAttribute("data-cell")).toBe("emz");
    expect(at(4, 3)).toHaveLength(0);
    expect(at(2, 3)).toHaveLength(0);
    expect(at(1, 3)[0]?.getAttribute("data-cell")).toBe("band-pile");
    expect(at(7, 3)[0]?.getAttribute("data-cell")).toBe("band-pile");
    for (const row of [1, 2, 4, 5]) for (let col = 1; col <= 7; col += 1) expect(at(col, row), `${col},${row}`).toHaveLength(1);
  });

  it("reads the far side right to left and keeps the sequence numbers", () => {
    const { container } = render(<SolidField {...props(solidEngine())} />);
    const monsterRow = (seat: number) => [...container.querySelectorAll(`[data-field-seat="${seat}"] [data-cell="mz"]`)]
      .map((cell) => cell.querySelector("[data-zones]")?.getAttribute("data-zones")?.split(" ")[0]);
    expect(monsterRow(0)).toEqual(["0:4:0", "0:4:1", "0:4:2", "0:4:3", "0:4:4"]);
    expect(monsterRow(1)).toEqual(["1:4:4", "1:4:3", "1:4:2", "1:4:1", "1:4:0"]);
  });

  it("draws no EMZ in Master Rule 3 and still shows both clock cells", () => {
    const engine = solidEngine({ masterRule: 3 });
    const { container } = render(<SolidField {...props(engine, 3)} renderClock={(seat) => <span data-test-clock={seat} />} />);
    expect(container.querySelectorAll('[data-cell="emz"]')).toHaveLength(0);
    expect(container.querySelector('[data-sv-clock="opp"]')).not.toBeNull();
    expect(container.querySelector('[data-sv-clock="you"]')).not.toBeNull();
  });

  it("gives Master Rule 3 Pendulum keys to the outer spell cells", () => {
    const engine = solidEngine({ masterRule: 3 });
    const { container } = render(<SolidField {...props(engine, 3)} />);
    const outer = [...container.querySelectorAll('[data-field-seat="0"] [data-cell="st"]')];
    const tokens = (cell: Element) => (cell.querySelector("[data-zones]")?.getAttribute("data-zones") ?? "").split(" ");
    expect(tokens(outer[0]).length).toBeGreaterThan(tokens(outer[1]).length);
    expect(tokens(outer[4]).length).toBeGreaterThan(tokens(outer[1]).length);
  });

  it("renders the clock of each seat in its own gap", () => {
    const { container } = render(<SolidField {...props(solidEngine())} renderClock={(seat) => <span data-test-clock={seat}>{`seat ${seat}`}</span>} />);
    const opp = container.querySelector('[data-sv-clock="opp"]') as HTMLElement;
    const you = container.querySelector('[data-sv-clock="you"]') as HTMLElement;
    expect(opp.style.gridColumn.startsWith("2")).toBe(true);
    expect(opp.style.gridRow.startsWith("3")).toBe(true);
    expect(you.style.gridColumn.startsWith("6")).toBe(true);
    expect(you.style.gridRow.startsWith("3")).toBe(true);
    expect(opp.textContent).toBe("seat 1");
    expect(you.textContent).toBe("seat 0");
  });

  it("flips the clock cells for a spectator", () => {
    const { container } = render(<SolidField {...props(solidEngine(), 5, null)} renderClock={(seat) => <span>{`seat ${seat}`}</span>} />);
    const texts = ["opp", "you"].map((side) => container.querySelector(`[data-sv-clock="${side}"]`)?.textContent);
    expect(new Set(texts).size).toBe(2);
  });
});
