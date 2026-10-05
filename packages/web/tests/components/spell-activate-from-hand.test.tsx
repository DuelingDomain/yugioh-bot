// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

vi.mock("@/components/duel/fx3d/use-fx3d", async () => {
  const { useRef } = await import("react");
  return { useFx3d: () => useRef(null) };
});

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { MoveFx } from "@/components/duel/move-fx";
import { SummonFx } from "@/components/duel/summon-fx";
import { duelFxClock } from "@/components/duel/fx-clock";
import { captureZoneSnapshots, clearZoneSnapshots, resetMoveSchedule } from "@/components/duel/move-plan";
import { CARDS } from "@/components/duel/fx-lab/cards";

const HAND = 0x02;
const SZONE = 0x08;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
let board: HTMLElement;
const animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
  return { finished: new Promise(() => {}), cancel: vi.fn(), effect: { getTiming: () => options } } as unknown as Animation;
});

beforeEach(() => {
  clearZoneSnapshots();
  resetMoveSchedule("spell-hand");
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const zone = this.closest("[data-zones]")?.getAttribute("data-zones") ?? "";
    return { left: zone.startsWith("0:2:") ? 600 : 100, top: 100, width: zone ? 70 : 1200, height: zone ? 100 : 900 } as DOMRect;
  });
  board = document.createElement("div");
  board.innerHTML = '<div data-zones="0:2:0" data-side="you"></div><div data-zones="0:8:1" data-side="you"><img src="/x.png" /></div>';
  document.body.append(board);
});
afterEach(() => {
  cleanup();
  board.remove();
  clearZoneSnapshots();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else delete (Element.prototype as Partial<Element>).animate;
});

function turns(): Array<Keyframe[]> {
  return animate.mock.calls.map(([frames]) => frames).filter((frames) => frames[0]?.transform?.toString().startsWith("rotateY("));
}

describe("a Spell activated from the hand", () => {
  // The engine puts the card in its Spell/Trap Zone face-down, then the chain link turns it face-up.
  const events = (extra: Partial<DuelEvent> = {}): DuelEvent[] => [
    { id: 1, kind: "move", text: "moved", seat: 0, card: CARDS.mst, from: z(0, HAND, 0), zone: z(0, SZONE, 1), reason: "activate", faceDown: true, ...extra },
    { id: 2, kind: "activate", text: "activate", seat: 0, card: CARDS.mst, zone: z(0, SZONE, 1), chainIndex: 1 },
  ];

  it("flies to its zone face-up, never turning onto its sleeve", () => {
    vi.useFakeTimers();
    captureZoneSnapshots(board);
    const { rerender } = render(<MoveFx events={[]} duelKey="spell-hand" reducedMotion={false} />);
    rerender(<MoveFx events={events()} duelKey="spell-hand" reducedMotion={false} />);
    act(() => vi.advanceTimersByTime(2000));
    // A turn from face-up to the sleeve would be a rotateY(180deg) keyframe.
    for (const frames of turns()) expect(frames.some((frame) => frame.transform === "rotateY(180deg)")).toBe(false);
  });

  it("still flies a Set Spell face-down", () => {
    vi.useFakeTimers();
    captureZoneSnapshots(board);
    const { rerender } = render(<MoveFx events={[]} duelKey="spell-hand" reducedMotion={false} />);
    rerender(<MoveFx events={events({ reason: "set" })} duelKey="spell-hand" reducedMotion={false} />);
    act(() => vi.advanceTimersByTime(2000));
    const [turn] = turns();
    expect(turn[turn.length - 1].transform).toBe("rotateY(180deg)");
  });
});

/** Every animation the board played, with the element it ran on. */
function played(): Array<{ el: Element; frames: Keyframe[] }> {
  return animate.mock.contexts.map((el: Element, index: number) => ({ el, frames: animate.mock.calls[index][0] as Keyframe[] }));
}

function Board({ events, reduced, seat = 0, sequence = 1 }: { events: DuelEvent[]; reduced: boolean; seat?: number; sequence?: number }) {
  return <div>
    <div data-zones="0:2:0" data-side="you" />
    <div data-zones={`${seat}:8:${sequence}`} data-side={seat === 0 ? "you" : "opp"}><span data-card-art><img src={`/api/cards/${CARDS.mst.code}/image`} /></span></div>
    <SummonFx events={events} duelKey="spell-hand" reducedMotion={reduced} shake="off" />
  </div>;
}

/** The zone must never be blank: the real card is never hidden and the copy on it never fades in from nothing. */
function expectNeverBlank(container: HTMLElement) {
  const art = container.querySelector("[data-card-art]")!;
  const ghost = container.querySelector(`img[src*="/cards/${CARDS.mst.code}/image?size=small"]`)!.parentElement!;
  const runs = played();
  const own = runs.find((run) => run.el === ghost);
  expect(own).toBeDefined();
  runs.filter((run) => run.el === art).forEach((run) => expect(run.frames.some((frame) => frame.opacity === 0)).toBe(false));
  expect(own!.frames[0].opacity).toBe(1);
  return ghost;
}

describe("a continuous Spell activated from the hand stays on screen", () => {
  const staying: DuelEvent[] = [
    { id: 1, kind: "move", text: "moved", seat: 0, card: CARDS.mst, from: z(0, HAND, 0), zone: z(0, SZONE, 1), reason: "activate", faceDown: true },
    { id: 2, kind: "activate", text: "activate", seat: 0, card: CARDS.mst, zone: z(0, SZONE, 1), chainIndex: 1 },
    { id: 3, kind: "chain-resolving", text: "resolve", chainIndex: 1 },
    { id: 4, kind: "chain-resolved", text: "resolved", chainIndex: 1 },
    { id: 5, kind: "chain-end", text: "end" },
  ];

  // The test board of the first group would answer the zone lookups first.
  beforeEach(() => { board.innerHTML = ""; });

  it.each([false, true])("never hides the card in its zone or fades its copy in from nothing (reduced=%s)", (reduced) => {
    duelFxClock.setReducedMotion(reduced);
    const { container, rerender } = render(<Board events={[]} reduced={reduced} />);
    rerender(<Board events={staying} reduced={reduced} />);
    expectNeverBlank(container);
  });

  it.each([false, true])("keeps a Field Spell from the hand whole in the Field Zone (reduced=%s)", (reduced) => {
    duelFxClock.setReducedMotion(reduced);
    const field = staying.map((event) => (event.zone ? { ...event, zone: z(0, SZONE, 5) } : event));
    const { container, rerender } = render(<Board events={[]} reduced={reduced} sequence={5} />);
    rerender(<Board events={field} reduced={reduced} sequence={5} />);
    expectNeverBlank(container);
  });
});

describe("a Set card activated on the field stays on screen", () => {
  const setting = (seat: number): DuelEvent[] => [
    { id: 1, kind: "set", text: "set", seat, zone: z(seat, SZONE, 1) },
  ];
  const activation = (seat: number): DuelEvent[] => [
    { id: 2, kind: "activate", text: "activate", seat, card: CARDS.mst, zone: z(seat, SZONE, 1), chainIndex: 1 },
    { id: 3, kind: "chain-resolving", text: "resolve", chainIndex: 1 },
    { id: 4, kind: "chain-resolved", text: "resolved", chainIndex: 1 },
    { id: 5, kind: "chain-end", text: "end" },
  ];
  /** The card was Set earlier; the board already shows it face-up when its activation plays. */
  function activate(reduced: boolean, seat: number, withSet = true) {
    duelFxClock.setReducedMotion(reduced);
    const view = render(<Board events={[]} reduced={reduced} seat={seat} />);
    if (withSet) view.rerender(<Board events={setting(seat)} reduced={reduced} seat={seat} />);
    view.rerender(<Board events={[...(withSet ? setting(seat) : []), ...activation(seat)]} reduced={reduced} seat={seat} />);
    return view.container;
  }
  const ghostOf = (container: HTMLElement) => container.querySelector(`img[src*="/cards/${CARDS.mst.code}/image?size=small"]`)!.parentElement!;

  beforeEach(() => { board.innerHTML = ""; });

  it.each([[false, 0], [true, 0], [false, 1], [true, 1]])("covers the zone from the first frame (reduced=%s, seat=%s)", (reduced, seat) => {
    const container = activate(reduced, seat);
    const ghost = ghostOf(container);
    const own = played().find((run) => run.el === ghost)!;
    expect(own.frames[0].opacity).toBe(1);
    // Whatever hides the real card runs under a copy that is already whole.
    const hidden = played().some((run) => run.el === container.querySelector("[data-card-art]") && run.frames.some((frame) => frame.opacity === 0));
    if (hidden) expect(own.frames[0].opacity).toBe(1);
  });

  it("turns from its sleeve to its face in place", () => {
    const ghost = ghostOf(activate(false, 0));
    const sleeve = ghost.querySelector("span")!;
    expect(sleeve).not.toBeNull();
    const frames = played().find((run) => run.el === sleeve)!.frames;
    expect(frames[0].opacity).toBe(1);
    expect(frames[frames.length - 1].opacity).toBe(0);
    // The turn is two quarter turns that never go edge-on to nothing.
    const turns = played().find((run) => run.el === ghost)!.frames.map((frame) => String(frame.transform));
    expect(turns[0]).toContain("rotateY(0deg)");
    expect(turns.some((turn) => turn.includes("rotateY(-84deg)"))).toBe(true);
  });

  it("shows its face at once under reduced motion, with no sleeve", () => {
    const ghost = ghostOf(activate(true, 0));
    expect(ghost.querySelector("span")).toBeNull();
    expect(played().find((run) => run.el === ghost)!.frames[0].opacity).toBe(1);
  });

  it("does not cover a face-up card that activates its effect with a sleeve", () => {
    const container = activate(false, 0, false);
    const ghost = ghostOf(container);
    expect(ghost.querySelector("span")).toBeNull();
    expect(played().some((run) => run.el === container.querySelector("[data-card-art]") && run.frames.some((frame) => frame.opacity === 0))).toBe(false);
  });
});
