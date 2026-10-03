// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelField } from "@/components/duel/field";
import { PositionFx, TURN_MS } from "@/components/duel/position-fx";
import { newBoard, edit } from "@/components/duel/fx-lab/board";
import { CARDS } from "@/components/duel/fx-lab/cards";

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else delete (Element.prototype as Partial<Element>).animate;
});

const position: DuelEvent = {
  id: 2, kind: "position", text: "Changed to Defense Position", seat: 1, card: CARDS.celtic,
  zone: { controller: 1, location: 4, sequence: 0 }, fromPosition: 1, toPosition: 4,
};
function engine(defense = false): DuelEngineView {
  const board = newBoard({}, {}, "battle_start", 0);
  edit.monster(1, 0, CARDS.celtic, defense ? 4 : 1)(board);
  return { revision: defense ? 1 : 0, turn: 3, turnSeat: 0, phase: board.phase, battleStep: "battle", seats: board.seats,
    prompt: null, chain: [], events: defense ? [position] : [], log: [], result: null };
}
function field(view: DuelEngineView, mySeat: number | null, fx = false) {
  return <>
    <DuelField engine={view} mySeat={mySeat} masterRule={5} reducedMotion
      legalKeys={new Set()} selectedKeys={new Set()} onActivate={() => {}} onInspect={() => {}} bottomName="You" topName="Opponent" />
    {fx ? <PositionFx events={view.events} duelKey="enemy-controller" reducedMotion={false} /> : null}
  </>;
}

describe("battle position presentation", () => {
  it.each([0, 1, null])("renders the engine's defense position for viewer %s", mySeat => {
    const { container, rerender } = render(field(engine(), mySeat));
    const zone = () => container.querySelector('[data-zones~="1:4:0"]')!;
    expect(zone().getAttribute("data-defense")).toBe("false");
    rerender(field(engine(true), mySeat));
    expect(zone().getAttribute("data-defense")).toBe("true");
    expect(zone().querySelector("[data-card-art]")?.getAttribute("data-defense")).toBe("true");
    expect(zone().getAttribute("data-side")).toBe(mySeat === 1 ? "you" : "opp");
  });

  it.each([0, 1, null])("animates the quarter-turn and keeps the defense orientation for viewer %s", mySeat => {
    const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) =>
      ({ finished: new Promise(() => {}), cancel: vi.fn() }) as unknown as Animation);
    Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return { left: 0, top: 0, width: this.closest("[data-zones]") ? 70 : 1200, height: this.closest("[data-zones]") ? 100 : 900 } as DOMRect;
    });
    const { container, rerender, unmount } = render(field(engine(), mySeat, true));
    rerender(field(engine(true), mySeat, true));
    const turn = animate.mock.calls.find(call => (call[1] as KeyframeAnimationOptions).duration === TURN_MS && (call[0] as Keyframe[])[0]?.transform?.toString().startsWith("rotate(0deg)"));
    expect(turn).toBeDefined();
    expect((turn![0] as Keyframe[]).at(-1)?.transform).toBe("rotate(90deg) translateY(0) scale(1)");
    expect(container.querySelector('[data-zones~="1:4:0"] [data-card-art]')?.getAttribute("data-defense")).toBe("true");
    unmount();
  });

  it("shows queried temporary ATK during a damage-calculation prompt", () => {
    const view = engine();
    view.battleStep = "damage-calculation";
    view.seats[1].monsters[0]!.attack = 200;
    const { container } = render(field(view, 0));
    expect(container.querySelector('[data-zones~="1:4:0"] b')?.textContent).toBe("200");
  });
});
