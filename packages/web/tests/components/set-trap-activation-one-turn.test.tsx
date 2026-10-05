// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
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

import { PositionFx } from "@/components/duel/position-fx";
import { SummonFx } from "@/components/duel/summon-fx";
import { duelFxClock } from "@/components/duel/fx-clock";
import { clearZoneSnapshots, resetMoveSchedule } from "@/components/duel/move-plan";
import { CARDS } from "@/components/duel/fx-lab/cards";

const SZONE = 0x08;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
let board: HTMLElement;
const animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
  return { finished: new Promise(() => {}), cancel: vi.fn(), effect: { getTiming: () => options } } as unknown as Animation;
});

beforeEach(() => {
  clearZoneSnapshots();
  resetMoveSchedule("set-trap");
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const zone = this.closest("[data-zones]")?.getAttribute("data-zones") ?? "";
    return { left: 100, top: 100, width: zone ? 70 : 1200, height: zone ? 100 : 900 } as DOMRect;
  });
  board = document.createElement("div");
  document.body.append(board);
});
afterEach(() => {
  cleanup();
  board.remove();
  clearZoneSnapshots();
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else delete (Element.prototype as Partial<Element>).animate;
});

function Board({ events, reduced, seat }: { events: DuelEvent[]; reduced: boolean; seat: number }) {
  return <div>
    <div data-zones={`${seat}:8:1`} data-side={seat === 0 ? "you" : "opp"}><span data-card-art><img src={`/api/cards/${CARDS.mst.code}/image`} /></span></div>
    <SummonFx events={events} duelKey="set-trap" reducedMotion={reduced} shake="off" />
    <div data-layer="position"><PositionFx events={events} duelKey="set-trap" reducedMotion={reduced} /></div>
  </div>;
}

/** The order the real engine sends (packages/duel-server/tests/trap-position-live.test.ts): the flip, then the activation. */
const setting = (seat: number): DuelEvent[] => [{ id: 1, kind: "set", text: "set", seat, zone: z(seat, SZONE, 1) }];
const activation = (seat: number): DuelEvent[] => [
  { id: 2, kind: "position", text: "flip", seat, card: CARDS.mst, zone: z(seat, SZONE, 1), fromPosition: 0x0a, toPosition: 0x05, flip: true } as DuelEvent,
  { id: 3, kind: "activate", text: "activate", seat, card: CARDS.mst, zone: z(seat, SZONE, 1), chainIndex: 1 },
  { id: 4, kind: "chain-resolving", text: "resolve", chainIndex: 1 },
  { id: 5, kind: "chain-resolved", text: "resolved", chainIndex: 1 },
  { id: 6, kind: "chain-end", text: "end" },
];

describe("a Set Trap activated on the field turns over once", () => {
  it.each([[false, 0], [true, 0], [false, 1], [true, 1]])("only the activation turns the card, not the flip too (reduced=%s, seat=%s)", (reduced, seat) => {
    duelFxClock.setReducedMotion(reduced);
    const view = render(<Board events={[]} reduced={reduced} seat={seat} />);
    view.rerender(<Board events={setting(seat)} reduced={reduced} seat={seat} />);
    view.rerender(<Board events={[...setting(seat), ...activation(seat)]} reduced={reduced} seat={seat} />);
    // PositionFx draws a copy on its own layer (normal motion) or fades the real card in (reduced motion): neither may play.
    const art = view.container.querySelector("[data-card-art]");
    const own = animate.mock.contexts.filter((el: Element) => el.closest('[data-layer="position"]') != null);
    expect(own).toHaveLength(0);
    const fades = animate.mock.calls.filter(([frames], index) => animate.mock.contexts[index] === art
      && (frames as Keyframe[]).length === 2 && (frames as Keyframe[])[0].opacity === 0 && (frames as Keyframe[])[1].opacity === 1);
    expect(fades).toHaveLength(0);
    // The one turn that plays is the activation copy, and it covers the zone from its first frame.
    const copy = view.container.querySelector(`img[src*="/cards/${CARDS.mst.code}/image?size=small"]`)!.parentElement!;
    const run = animate.mock.calls.find(([, ], index) => animate.mock.contexts[index] === copy)!;
    expect((run[0] as Keyframe[])[0].opacity).toBe(1);
  });
});
