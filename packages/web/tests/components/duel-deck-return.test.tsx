// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { MoveFx } from "@/components/duel/move-fx";
import { findZoneElement } from "@/components/duel/event-queue";
import { captureZoneSnapshots, clearZoneSnapshots, resetMoveSchedule, resolveSource } from "@/components/duel/move-plan";
import { CARDS } from "@/components/duel/fx-lab/cards";

const DECK = 0x01;
const MZONE = 0x04;
const GRAVE = 0x10;
const EXTRA = 0x40;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
let board: HTMLElement;
const animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
  return { finished: new Promise(() => {}), cancel: vi.fn(), effect: { getTiming: () => options } } as unknown as Animation;
});

beforeEach(() => {
  clearZoneSnapshots();
  resetMoveSchedule("deck-return");
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const zone = this.closest("[data-zones]")?.getAttribute("data-zones") ?? "";
    // The Deck pile sits far to the right of the Monster Zone.
    return { left: zone.startsWith("0:1:") ? 600 : 100, top: 100, width: zone ? 70 : 1200, height: zone ? 100 : 900 } as DOMRect;
  });
  board = document.createElement("div");
  // The board already shows the new state: the monster left its zone; the Deck is one anchor keyed at sequence 0.
  board.innerHTML = '<div data-zones="0:4:2" data-side="you"><img src="/x.png" /></div>'
    + '<div data-zones="0:1:0" data-side="you"></div>'
    + '<div data-zones="0:64:0 0:64:1" data-side="you"></div>'
    + '<div data-zones="0:16:0" data-side="you"><div data-fi="0"></div></div>';
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

describe("the Deck anchor", () => {
  it.each([0, 1, 27, 28])("finds the Deck pile for the engine sequence %s", (sequence) => {
    expect(findZoneElement(z(0, DECK, sequence))).toBe(board.querySelector('[data-zones="0:1:0"]'));
  });
  it("finds the Extra Deck pile for a sequence it does not list", () => {
    expect(findZoneElement(z(0, EXTRA, 5))).toBe(board.querySelector('[data-zones="0:64:0 0:64:1"]'));
  });
  it("does not invent an anchor in other places", () => {
    expect(findZoneElement(z(0, GRAVE, 4))).toBeNull();
    expect(findZoneElement(z(0, MZONE, 4))).toBeNull();
    expect(findZoneElement(z(1, DECK, 28))).toBeNull();
  });
  it("aims a card that leaves the top of the Deck at the Deck pile", () => {
    expect(resolveSource(z(0, DECK, 27))?.rect.left).toBe(600);
  });
});

function flights(): Array<Keyframe[]> {
  return animate.mock.calls.map(([frames]) => frames).filter((frames) => frames[0]?.transform?.toString().startsWith("translate3d("));
}

function turns(): Array<Keyframe[]> {
  return animate.mock.calls.map(([frames]) => frames).filter((frames) => frames[0]?.transform?.toString().startsWith("rotateY("));
}

describe("a card returned to the Deck", () => {
  const events = (sequence: number, extra: Partial<DuelEvent> = {}): DuelEvent[] => [{
    id: 1, kind: "move", text: "moved", seat: 0, card: CARDS.celtic, from: z(0, MZONE, 2), zone: z(0, DECK, sequence), reason: "return", ...extra,
  }];

  it.each([["top", 28], ["bottom", 0], ["shuffle", 17]])("flies to the Deck and turns face-down (%s)", (_name, sequence) => {
    vi.useFakeTimers();
    captureZoneSnapshots(board);
    const { rerender } = render(<MoveFx events={[]} duelKey="deck-return" reducedMotion={false} />);
    rerender(<MoveFx events={events(sequence)} duelKey="deck-return" reducedMotion={false} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(flights()).toHaveLength(1);
    // The arrow of the flight points from the zone to the Deck pile, a toss with a spin.
    const [turn] = turns();
    expect(turn[0].transform).toBe("rotateY(0deg)");
    expect(turn[turn.length - 1].transform).toBe("rotateY(180deg)");
  });

  it("flies a hidden card as a sleeve", () => {
    vi.useFakeTimers();
    captureZoneSnapshots(board);
    const { container, rerender } = render(<MoveFx events={[]} duelKey="deck-return" reducedMotion={false} />);
    rerender(<MoveFx events={events(28, { card: undefined })} duelKey="deck-return" reducedMotion={false} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(flights()).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();
  });
});
