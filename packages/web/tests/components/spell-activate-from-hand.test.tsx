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
