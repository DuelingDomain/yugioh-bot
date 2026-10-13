// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelCardInfo, DuelEngineView, DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";
import { DuelField } from "@/components/duel/field";
import { SummonFx, syncSetZones, trackSetZones } from "@/components/duel/summon-fx";
import { MoveFx, hideElement } from "@/components/duel/move-fx";
import { zoneCardBox, zoneCardParts, zoneFrameOf } from "@/components/duel/event-queue";
import { quadMatrix3d, type Quad } from "@/components/duel/quad";
import { CARDS } from "@/components/duel/fx-lab/cards";
import { LOCATION_SZONE } from "@/components/duel/constants";
import summonStyles from "@/components/duel/summon-fx.module.css";

vi.mock("@/components/duel/fx3d/use-fx3d", async () => {
  const { useRef } = await import("react");
  return { useFx3d: () => useRef(null) };
});

const key = "activation-board";
const zone = { controller: 0, location: 0x08, sequence: 2 };
const callbacks = { legalKeys: new Set<string>(), selectedKeys: new Set<string>(), onActivate: vi.fn(), onInspect: vi.fn() };
const trap: DuelCardInfo = { ...CARDS.mirrorForce, code: 12607053, name: "Waboku", type: 0x04 };

function engine(card: DuelCard | null, events: DuelEvent[] = []): DuelEngineView {
  const seats: DuelSeatView[] = Array.from({ length: 2 }, (_, seat) => ({
    seat, lp: 8000, hand: [], deckCount: 20, extraCount: 0, extra: [], graveyard: [], banished: [],
    monsters: Array<null>(7).fill(null), spells: Array<null>(8).fill(null),
  }));
  if (card) seats[0].spells[card.sequence] = card;
  return { revision: events.length, format: "1v1", turn: 2, turnSeat: 1, phase: "main1", seats,
    prompt: null, prioritySeat: null, chain: [], events, log: [], result: null };
}

function Board({ view }: { view: DuelEngineView }) {
  return <div>
    <DuelField engine={view} mySeat={0} masterRule={5} bottomName="Local" topName="Opponent" reducedMotion={false} {...callbacks} />
    <SummonFx seats={view.seats} events={view.events} duelKey={key} reducedMotion={false} shake="off" />
    <MoveFx events={view.events} duelKey={key} reducedMotion={false} />
  </div>;
}

// The card box as a tilted camera shows it: a trapezoid, wider at the bottom.
const TILT: Quad = [{ x: 150, y: 110 }, { x: 210, y: 110 }, { x: 232, y: 200 }, { x: 128, y: 200 }];
let animations: Array<{ element: Element; frames: Keyframe[] }>;

beforeEach(() => {
  vi.useFakeTimers();
  animations = [];
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1100);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(860);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(60);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(90);
  // jsdom has no stylesheet: the card box would read as `static`, which the corner probe refuses.
  const realStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
    const style = realStyle(el, pseudo);
    if (!el.querySelector(":scope > [data-card-art]")) return style;
    return Object.create(style, { position: { value: "absolute" } });
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} });
    if (this.getAttribute("aria-hidden") === "true" && (this as HTMLElement).style.width === "0px") {
      const el = this as HTMLElement;
      const at = (el.style.left === "100%" ? 1 : 0) + (el.style.top === "100%" ? 2 : 0);
      const p = TILT[[0, 1, 3, 2][at]];
      return rect(p.x, p.y, 0, 0) as DOMRect;
    }
    if (this.hasAttribute("data-zones") || this.closest("[data-zones]")) return rect(120, 100, 100, 100) as DOMRect;
    return rect(0, 0, 1100, 860) as DOMRect;
  });
  vi.stubGlobal("Animation", class {});
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: function (frames: Keyframe[]) {
    animations.push({ element: this, frames });
    return { finished: new Promise(() => {}), cancel() {}, playbackRate: 1 };
  } });
});
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else delete (Element.prototype as Partial<Element>).animate;
});

/** Applies a CSS matrix3d string to a local point, the way a browser does (with the perspective divide). */
function project(matrix: string, x: number, y: number): [number, number] {
  const m = /matrix3d\((.*)\)/.exec(matrix)![1].split(",").map(Number);
  const w = m[3] * x + m[7] * y + m[15];
  return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
}

describe("the real board structure", () => {
  const set: DuelCard = { ...trap, ...zone, position: 0x0a };

  it("zoneFrameOf finds the outline, and zoneCardParts leaves out the outline and the zone label", () => {
    const { container } = render(<DuelField engine={engine({ ...set, type: 0x1000004 })} mySeat={0} masterRule={5} bottomName="L" topName="O" reducedMotion {...callbacks} />);
    const node = container.querySelector<HTMLElement>('[data-zones~="0:8:2"]')!;
    const frame = zoneFrameOf(node)!;
    expect(frame.hasAttribute("data-card-frame")).toBe(true);
    const parts = zoneCardParts(node);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts).not.toContain(frame);
    for (const part of parts) expect(part.hasAttribute("data-zone-label")).toBe(false);
    expect(zoneCardBox(node)).toBe(node.querySelector("[data-card-art]")!.parentElement);
  });

  it("keeps the outline and the zone label drawn while a part added late (a plate, a mark) stays hidden", () => {
    const { container } = render(<DuelField engine={engine(set)} mySeat={0} masterRule={5} bottomName="L" topName="O" reducedMotion {...callbacks} />);
    const node = container.querySelector<HTMLElement>('[data-zones~="0:8:2"]')!;
    const frame = zoneFrameOf(node)!;
    const release = hideElement(frame);
    const late = document.createElement("span");
    frame.appendChild(late);
    expect(frame.hasAttribute("data-card-hidden")).toBe(true);
    expect(frame.style.visibility).not.toBe("hidden");
    release();
    expect(frame.hasAttribute("data-card-hidden")).toBe(false);
  });
});

describe("a Set card the events never showed", () => {
  const slot = { controller: 0, location: LOCATION_SZONE, sequence: 3 };
  const info = { code: 12607053, name: "Waboku" } as DuelEvent["card"];
  const activate = { id: 2, kind: "activate", seat: 0, zone: slot, card: info, chainIndex: 1, text: "" } as DuelEvent;

  it("is learned from the view, so its activation turns once", () => {
    const zones = new Set<string>();
    const view = engine({ ...trap, ...slot, position: 0x0a });
    syncSetZones(zones, view.seats);
    const activated = new Set<number>();
    trackSetZones(zones, activate, activated, [activate]);
    expect([...activated]).toEqual([2]);
  });

  it("is forgotten when the view shows it face-up, and learned again when it is turned face-down in place", () => {
    const zones = new Set<string>();
    syncSetZones(zones, engine({ ...trap, ...slot, position: 0x0a }).seats);
    syncSetZones(zones, engine({ ...trap, ...slot, position: 0x05 }).seats);
    expect(zones.size).toBe(0);
    const down = { id: 3, kind: "position", seat: 0, zone: slot, card: info, fromPosition: 0x05, toPosition: 0x0a, conceal: true, text: "" } as unknown as DuelEvent;
    trackSetZones(zones, down, new Set(), [down]);
    expect(zones.size).toBe(1);
    const activated = new Set<number>();
    trackSetZones(zones, activate, activated, [activate]);
    expect([...activated]).toEqual([2]);
  });
});

describe("quadMatrix3d", () => {
  it("maps the box corners onto the quad, also for a trapezoid", () => {
    const matrix = quadMatrix3d(60, 90, TILT)!;
    const corners = [[0, 0], [60, 0], [60, 90], [0, 90]].map(([x, y]) => project(matrix, x, y));
    corners.forEach(([x, y], i) => { expect(x).toBeCloseTo(TILT[i].x, 3); expect(y).toBeCloseTo(TILT[i].y, 3); });
  });

  it("refuses a quad that is no outline", () => {
    const dot = { x: 5, y: 5 };
    expect(quadMatrix3d(60, 90, [dot, dot, dot, dot])).toBeNull();
    expect(quadMatrix3d(0, 90, TILT)).toBeNull();
  });
});

describe("the activation copy on a tilted stage", () => {
  it("lies on the card box with the card's own size and tilt", () => {
    const set: DuelCard = { ...trap, ...zone, position: 0x0a };
    const events: DuelEvent[] = [
      { id: 1, kind: "position", text: "flipped", card: trap, zone, fromPosition: 0x0a, toPosition: 0x05, flip: true },
      { id: 2, kind: "activate", text: "activating", seat: 0, card: trap, zone, chainIndex: 1 },
    ];
    const result = render(<Board view={engine(set)} />);
    result.rerender(<Board view={engine({ ...set, position: 0x05 }, events)} />);
    const ghost = result.container.querySelector<HTMLElement>(`.${summonStyles.flipGhost}`)!;
    const anchor = ghost.closest<HTMLElement>(`.${summonStyles.anchor}`)!;
    expect(anchor.style.transformOrigin).toBe("0 0");
    expect(anchor.style.width).toBe("60px");
    expect(anchor.style.height).toBe("90px");
    const corners = [[0, 0], [60, 0], [60, 90], [0, 90]].map(([x, y]) => project(anchor.style.transform, x, y));
    corners.forEach(([x, y], i) => { expect(x).toBeCloseTo(TILT[i].x, 2); expect(y).toBeCloseTo(TILT[i].y, 2); });
  });
});
