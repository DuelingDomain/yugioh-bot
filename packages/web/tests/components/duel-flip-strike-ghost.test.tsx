// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SummonFx } from "@/components/duel/summon-fx";
import { flipStrikeHideMs, planChainBeats, resetChainBeats } from "@/components/duel/chain-beats";
import { flipSequenceSteps } from "@/components/duel/flip-sequence";
import { duelFxClock } from "@/components/duel/fx-clock";
import { clearBattleHolds } from "@/components/duel/battle-hold";
import { clearZoneSnapshots, resetMoveSchedule } from "@/components/duel/move-plan";
import { CARDS } from "@/components/duel/fx-lab/cards";

const A = { controller: 0, location: 4, sequence: 0 };
const D = { controller: 1, location: 4, sequence: 0 };
const KEY = "strike-ghost";

const attack: DuelEvent = { id: 2, kind: "attack", seat: 0, text: "attack", zone: A, target: D };
const flip: DuelEvent = { id: 3, kind: "position", seat: 1, text: "flipped", zone: D, flip: true, fromPosition: 8, toPosition: 4 };
const activate: DuelEvent = { id: 5, kind: "activate", seat: 1, text: "activating", zone: D, chainIndex: 1 };
const destroyed: DuelEvent = { id: 9, kind: "destroy", seat: 0, text: "destroyed", zone: A, card: CARDS.celtic, cause: "effect" };

const animate = vi.fn(function (this: Element, _frames: Keyframe[], options: KeyframeAnimationOptions) {
  return { finished: new Promise(() => {}), cancel: vi.fn(), effect: { getTiming: () => options } } as unknown as Animation;
});
const original = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
let board: HTMLElement;

beforeEach(() => {
  clearBattleHolds();
  clearZoneSnapshots();
  resetMoveSchedule(KEY);
  resetChainBeats(KEY);
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const zone = this.closest("[data-zones]");
    return { left: 100, top: 100, width: zone ? 70 : 1200, height: zone ? 100 : 900 } as DOMRect;
  });
  board = document.createElement("div");
  board.innerHTML = '<div data-zones="0:4:0"></div><div data-zones="1:4:0"></div><div data-zones="0:16:0"><div data-fi="0"></div></div>';
  document.body.append(board);
});
afterEach(() => {
  cleanup();
  board.remove();
  vi.restoreAllMocks();
  if (original) Object.defineProperty(Element.prototype, "animate", original);
  else delete (Element.prototype as Partial<Element>).animate;
});

const hidden = () => animate.mock.calls.filter(([frames]) =>
  Array.isArray(frames) && frames.length === 2 && frames.every(frame => (frame as Keyframe).opacity === 0));

describe("the attacker stand-in during a flip strike", () => {
  it("reports the strike window of the attacker zone only", () => {
    const now = duelFxClock.now();
    planChainBeats([attack, flip, activate], { now, reduced: false, duelKey: KEY });
    const { attackMs } = flipSequenceSteps(false);
    expect(flipStrikeHideMs(A, now)).toBeGreaterThan(0);
    expect(flipStrikeHideMs(A, now)).toBeLessThanOrEqual(attackMs + 1);
    expect(flipStrikeHideMs(A, now + attackMs + 1)).toBe(0);
    expect(flipStrikeHideMs(D, now)).toBe(0);
  });

  it("hides the destroy ghost of the attacker while the copy lunges", () => {
    const events = [attack, flip, activate, destroyed];
    planChainBeats(events, { now: duelFxClock.now(), reduced: false, duelKey: KEY });
    const { rerender } = render(<SummonFx events={[]} duelKey={KEY} reducedMotion={false} shake="off" />);
    rerender(<SummonFx events={events} duelKey={KEY} reducedMotion={false} shake="off" />);
    expect(hidden().length).toBeGreaterThanOrEqual(1);
  });

  it("does not hide the ghost of a card that no strike owns", () => {
    const events = [{ ...destroyed, id: 4, cause: "battle" as const }];
    const { rerender } = render(<SummonFx events={[]} duelKey={KEY} reducedMotion={false} shake="off" />);
    rerender(<SummonFx events={events} duelKey={KEY} reducedMotion={false} shake="off" />);
    expect(hidden()).toHaveLength(0);
  });
});
