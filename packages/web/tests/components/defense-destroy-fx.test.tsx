// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SummonFx } from "@/components/duel/summon-fx";
import { MoveFx } from "@/components/duel/move-fx";
import { captureZoneSnapshots, clearZoneSnapshots, resetMoveSchedule } from "@/components/duel/move-plan";
import { clearBattleHolds } from "@/components/duel/battle-hold";
import { CARDS } from "@/components/duel/fx-lab/cards";

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
let board: HTMLElement;
const animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
  return { finished: new Promise(() => {}), cancel: vi.fn(), effect: { getTiming: () => options } } as unknown as Animation;
});
beforeEach(() => {
  clearBattleHolds();
  clearZoneSnapshots();
  resetMoveSchedule("defense");
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const zone = this.closest("[data-zones]");
    return { left: zone?.getAttribute("data-zones") === "1:16:0" ? 450 : 100,
      top: 100, width: zone ? 70 : 1200, height: zone ? 100 : 900 } as DOMRect;
  });
  board = document.createElement("div");
  // The latest board has already removed the defender. The event must supply its old pose.
  board.innerHTML = '<div data-zones="1:4:0" data-defense="false"></div><div data-zones="1:16:0"><div data-fi="0"></div></div>';
  document.body.append(board);
});
afterEach(() => {
  cleanup();
  board.remove();
  clearZoneSnapshots();
  clearBattleHolds();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else delete (Element.prototype as Partial<Element>).animate;
});

const destroy: DuelEvent = { id: 2, kind: "destroy", text: "Destroyed in defense", seat: 1,
  zone: { controller: 1, location: 4, sequence: 0 }, card: CARDS.celtic, cause: "battle", fromPosition: 4 };
const move: DuelEvent = { ...destroy, id: 1, kind: "move", reason: "destroy", from: destroy.zone,
  zone: { controller: 1, location: 16, sequence: 0 } };

describe("Defense Position casualty presentation", () => {
  it.each([0, 1, null])("keeps the destroy stand-in sideways for viewer %s after the card leaves the board", viewer => {
    board.firstElementChild!.setAttribute("data-side", viewer === 1 ? "you" : "opp");
    const { container, rerender } = render(<SummonFx events={[]} duelKey="defense" reducedMotion={false} shake="off" />);
    rerender(<SummonFx events={[destroy]} duelKey="defense" reducedMotion={false} shake="off" />);
    const portrait = container.querySelector('img[src*="/cards/"]')!;
    const anchor = portrait?.parentElement?.parentElement;
    expect(anchor?.style.rotate).toBe("90deg");
    expect(anchor?.getAttribute("data-side")).toBe(viewer === 1 ? "you" : "opp");
  });

  it.each([0, 1, null])("starts the Graveyard flight in defense for viewer %s despite a stale source snapshot", viewer => {
    vi.useFakeTimers();
    for (const zone of board.children) zone.setAttribute("data-side", viewer === 1 ? "you" : "opp");
    captureZoneSnapshots(board);
    const { rerender } = render(<MoveFx events={[]} duelKey="defense" reducedMotion={false} />);
    rerender(<MoveFx events={[move, destroy]} duelKey="defense" reducedMotion={false} />);
    act(() => vi.advanceTimersByTime(2000));
    const flight = animate.mock.calls.find(([frames]) => frames[0]?.transform?.toString().startsWith("translate3d("));
    expect(flight).toBeDefined();
    expect(flight![0][0].transform).toContain(`rotate(${viewer === 1 ? 90 : 270}.00deg)`);
  });
});
