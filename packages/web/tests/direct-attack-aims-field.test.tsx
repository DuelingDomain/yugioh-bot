// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

// Keep the real FX but record the plan of each attack: `hit` is where the attacker strikes.
const plans: Array<{ hit: { left: number; top: number; width: number; height: number }; lpHits: Array<{ box: { left: number; top: number; width: number; height: number } }> }> = [];
vi.mock("@/components/duel/attack-fx", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/duel/attack-fx")>();
  return {
    ...real,
    runAttackFx: (_html: HTMLElement, _svg: SVGSVGElement, plan: (typeof plans)[number]) => {
      plans.push(plan);
      return () => {};
    },
  };
});

import { BattleFx } from "@/components/duel/battle-fx";
import { directTargetNode } from "@/components/duel/direct-target";
import { AimArrow } from "@/components/duel/table/aim-arrow";
import { AttackLine } from "@/components/duel/table/attack-line";
import { PlaneSvg } from "@/components/duel/solid/plane-svg";

/**
 * A tiny board: the attacker (seat 0), and for the defender (seat 1) the field row and the LP plate. `data-rect` is the
 * screen box of each node (jsdom has no layout).
 */
const rect = (l: number, t: number, w: number, h: number) => `${l},${t},${w},${h}`;
const FIELD = { l: 500, t: 80, w: 300, h: 70 }; // centre 650,115
const PLATE = { l: 40, t: 700, w: 120, h: 40 }; // centre 100,720
const fieldCentre = { x: FIELD.l + FIELD.w / 2, y: FIELD.t + FIELD.h / 2 };
const plateCentre = { x: PLATE.l + PLATE.w / 2, y: PLATE.t + PLATE.h / 2 };

function board(seat = 1, fieldRect = rect(FIELD.l, FIELD.t, FIELD.w, FIELD.h)) {
  document.body.innerHTML = `
    <div data-table-stage>
      <div data-zones="0:4:2" data-rect="${rect(300, 500, 60, 84)}"><span data-card-art data-rect="${rect(300, 500, 60, 84)}"></span></div>
      <div data-seat-field="${seat}" data-rect="${rect(480, 60, 340, 220)}">
        <div data-monster-row="${seat}" data-rect="${fieldRect}"></div>
      </div>
      <div data-holo="${seat}" data-rect="${rect(PLATE.l, PLATE.t, PLATE.w, PLATE.h)}">
        <div data-lp-seat="${seat}" data-rect="${rect(PLATE.l, PLATE.t, PLATE.w, PLATE.h)}"><strong data-rect="${rect(PLATE.l + 10, PLATE.t + 6, 60, 28)}">8000</strong></div>
      </div>
    </div>`;
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const raw = this.getAttribute("data-rect");
    const [left, top, width, height] = raw ? raw.split(",").map(Number) : [0, 0, 0, 0];
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  };
});
beforeEach(() => {
  plans.length = 0;
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const frame = () => act(() => new Promise<void>((resolve) => void requestAnimationFrame(() => resolve())));
const centreOf = (box: { left: number; top: number; width: number; height: number }) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

/** The last point of an SVG path "M.. Q.. x y". */
function tipOf(d: string): { x: number; y: number } {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  return { x: nums[nums.length - 2], y: nums[nums.length - 1] };
}
const near = (a: { x: number; y: number }, b: { x: number; y: number }, within = 2) => Math.hypot(a.x - b.x, a.y - b.y) <= within;

describe("the node a direct attack aims at", () => {
  it("is the monster row of the seat, before its field mat and its LP plate", () => {
    board();
    expect(directTargetNode(1)?.getAttribute("data-monster-row")).toBe("1");
  });

  it("falls back to the field mat, then to the LP plate, when the row is not on screen", () => {
    board();
    document.querySelector("[data-monster-row]")!.removeAttribute("data-rect");
    expect(directTargetNode(1)?.hasAttribute("data-seat-field")).toBe(true);
    document.querySelector("[data-seat-field]")!.removeAttribute("data-rect");
    expect(directTargetNode(1)?.hasAttribute("data-holo")).toBe(true);
  });
});

describe("the aim arrow of a pointer-driven direct attack", () => {
  it("ends at the middle of the defender's field, not at the LP plate", async () => {
    board();
    render(<AimArrow fromKey="0:4:2" tone="violet" targetTone={null} pointer={{ current: null }} snap={{ lpSeat: 1 }} label="Direct attack: Ren" />);
    await frame();
    const tip = tipOf(document.querySelector("[data-aim-arrow] path[marker-end]")?.getAttribute("d") ?? "");
    expect(near(tip, fieldCentre)).toBe(true);
    expect(near(tip, plateCentre, 40)).toBe(false);
  });

  it("follows the field when the camera moves it", async () => {
    board();
    render(<AimArrow fromKey="0:4:2" tone="violet" targetTone={null} pointer={{ current: null }} snap={{ lpSeat: 1 }} label={null} />);
    await frame();
    document.querySelector("[data-monster-row]")!.setAttribute("data-rect", rect(900, 300, 70, 300));
    await frame();
    const tip = tipOf(document.querySelector("[data-aim-arrow] path[marker-end]")?.getAttribute("d") ?? "");
    expect(near(tip, { x: 935, y: 450 })).toBe(true);
  });
});

describe("the attack line of a table (FFA, Tag) on a direct attack", () => {
  it("ends at the middle of the defender's field, not at the LP plate", async () => {
    board();
    const stage = document.querySelector("[data-table-stage]")!;
    const { container } = render(<AttackLine aim={{ mode: "aim", from: "0:4:2", to: { lpSeat: 1 } }} tone="violet" />, { container: stage.appendChild(document.createElement("div")) });
    const svg = container.querySelector("svg")!;
    svg.setAttribute("data-rect", rect(0, 0, 1100, 860));
    await frame();
    const ends = [...svg.querySelectorAll("g[transform]")].map((g) => g.getAttribute("transform")!);
    const last = ends[ends.length - 1].match(/translate\(([-\d.]+) ([-\d.]+)\)/)!;
    expect(near({ x: Number(last[1]), y: Number(last[2]) }, fieldCentre)).toBe(true);
  });
});

describe("the declared-attack marker of a direct attack (BattleFx)", () => {
  it("points the arrow and rings the field of the defender", async () => {
    board();
    const { container } = render(
      <BattleFx events={[]} seats={[{ seat: 0, monsters: [] }, { seat: 1, monsters: [] }] as unknown as DuelSeatView[]} reducedMotion active aim={{ mode: "locked", from: "0:4:2", to: { lpSeat: 1 } }} />,
    );
    await frame();
    const lines = [...container.querySelectorAll("[data-aim] g > g path")].map((p) => p.getAttribute("d")!).filter((d) => d.startsWith("M") && d.includes("Q"));
    expect(lines).toHaveLength(2); // the shadow and the line
    const tip = tipOf(lines[0]);
    // The tip stops short of the target's edge, on the side of the attacker; it must be on the field, not near the plate.
    expect(tip.y).toBeLessThan(250);
    expect(tip.x).toBeGreaterThan(450);
    // The last ring is the target's: it wraps the whole row (the first one is the attacker's).
    const rings = container.querySelectorAll("[data-aim] rect");
    expect(Number(rings[rings.length - 1]?.getAttribute("width"))).toBeGreaterThan(FIELD.w);
  });
});

describe("the attack animation of a direct attack (BattleFx)", () => {
  const events = (targetSeat?: number): DuelEvent[] => [
    { id: 1, kind: "attack", seat: 0, zone: { controller: 0, location: 4, sequence: 2 }, targetSeat, text: "attack" } as DuelEvent,
    { id: 2, kind: "damage", seat: 1, amount: 1800, text: "damage" } as DuelEvent,
  ];

  const run = async (seats: number, targetSeat?: number) => {
    board();
    const seatViews = Array.from({ length: seats }, (_, seat) => ({ seat, monsters: [], spells: [] })) as unknown as DuelSeatView[];
    const view = render(<BattleFx events={[]} seats={seatViews} reducedMotion active />);
    view.rerender(<BattleFx events={events(targetSeat)} seats={seatViews} reducedMotion active />);
    await frame();
    await frame();
  };

  it("strikes the field of the defender, and the damage still shows on the LP plate (2 seats)", async () => {
    await run(2);
    expect(plans).toHaveLength(1);
    expect(near(centreOf(plans[0].hit), fieldCentre)).toBe(true);
    expect(plans[0].hit.width).toBe(FIELD.w);
    expect(plans[0].lpHits).toHaveLength(1);
    expect(near(centreOf(plans[0].lpHits[0].box), { x: PLATE.l + 40, y: PLATE.t + 20 })).toBe(true);
  });

  it("strikes the field of the named defender at a table of 3 or 4 seats", async () => {
    await run(3, 1);
    expect(plans).toHaveLength(1);
    expect(near(centreOf(plans[0].hit), fieldCentre)).toBe(true);
  });

  it("measures a turned field by its box on the screen (a seat on the side)", async () => {
    board();
    const view = render(<BattleFx events={[]} seats={[{ seat: 0, monsters: [] }, { seat: 1, monsters: [] }] as unknown as DuelSeatView[]} reducedMotion active />);
    document.querySelector("[data-monster-row]")!.setAttribute("data-rect", rect(900, 300, 70, 300));
    view.rerender(<BattleFx events={events()} seats={[{ seat: 0, monsters: [] }, { seat: 1, monsters: [] }] as unknown as DuelSeatView[]} reducedMotion active />);
    await frame();
    expect(near(centreOf(plans[0].hit), { x: 935, y: 450 })).toBe(true);
  });
});

describe("the solid 1v1 plane", () => {
  /** jsdom has no layout: give a node the offset box that the plane reads. */
  const lay = (el: HTMLElement, parent: HTMLElement, x: number, y: number, w: number, h: number) => {
    for (const [name, value] of Object.entries({ offsetParent: parent, offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h })) {
      Object.defineProperty(el, name, { configurable: true, value });
    }
  };

  it("lands on the near edge of the defender's monster row, like a card target, and rings the row", async () => {
    const { container } = render(
      <div data-plane ref={(el) => { if (el) Object.defineProperties(el, { offsetWidth: { configurable: true, value: 600 }, offsetHeight: { configurable: true, value: 400 } }); }}>
        <div data-zones="0:4:2" ref={(el) => { if (el) lay(el, el.parentElement!, 270, 300, 60, 60); }} />
        <div data-monster-row="1" ref={(el) => { if (el) lay(el, el.parentElement!, 100, 40, 400, 60); }} />
        <PlaneSvg aim={{ mode: "aim", from: "0:4:2", to: { lpSeat: 1 } }} />
      </div>,
    );
    await frame();
    const path = container.querySelector("svg path[marker-end]")?.getAttribute("d") ?? "";
    // The row's middle is x 300; the path ends at its near (lower) edge, inside the plane, not past the far edge.
    const tip = tipOf(path);
    expect(tip.x).toBe(300);
    expect(tip.y).toBeGreaterThan(0);
    expect(container.querySelectorAll("svg rect").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the old far-edge pointer when the plane holds no field row", async () => {
    const { container } = render(
      <div data-plane>
        <div data-zones="0:4:2" ref={(el) => { if (el) lay(el, el.parentElement!, 270, 300, 60, 60); }} />
        <PlaneSvg aim={{ mode: "aim", from: "0:4:2", to: { lpSeat: 1 } }} />
      </div>,
    );
    await frame();
    const path = container.querySelector("svg path[marker-end]")?.getAttribute("d") ?? "";
    expect(tipOf(path).y).toBeLessThan(0);
  });
});
