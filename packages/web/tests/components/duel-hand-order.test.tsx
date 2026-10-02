// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DuelField } from "@/components/duel/field";
import { findMoveDestination } from "@/components/duel/event-queue";
import { applyEdits } from "@/components/duel/fx-lab/board";
import { findScenario } from "@/components/duel/fx-lab/scenarios";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
afterEach(cleanup);

describe("display hand order and engine selection", () => {
  it("keeps DOM identities through engine reordering and clicks the current engine coordinate", () => {
    const script = findScenario("move-hand-order")!.build();
    const after = applyEdits(script.initial, script.steps[0]!.edits!);
    const next = applyEdits(after, script.steps[1]!.edits!);
    const activate = vi.fn();
    const field = (seats: typeof after.seats) => <DuelField
      engine={{ revision: 1, turn: 1, turnSeat: 0, phase: "main1", battleStep: null, seats, prompt: null, chain: [], events: [], log: [], result: null }}
      mySeat={0} masterRule={5} reducedMotion legalKeys={new Set()} selectedKeys={new Set()}
      onActivate={activate} onInspect={() => {}} bottomName="You" topName="Opp" />;
    const view = render(field(after.seats));
    const card = view.container.querySelector('[data-hand-id="lab-added"]')!;
    expect(card).toBe(view.container.querySelector('[data-hand-seat="0"]')!.lastElementChild);
    view.rerender(field(next.seats));
    expect(view.container.querySelector('[data-hand-id="lab-added"]')).toBe(card);
    const zone = card.querySelector<HTMLElement>("[data-zones]")!;
    fireEvent.click(zone.querySelector("button")!);
    expect(activate.mock.calls[0]![0]).toEqual(["0:2:0"]);
    const event = { ...script.steps[0]!.events![0]!, id: 1 };
    expect(event.zone?.sequence).toBe(4); // stale core coordinate at the time it was added
    expect(findMoveDestination(event)).toBe(zone);
    expect(findMoveDestination({ ...event, handId: "departed" })).toBeNull();
    const far = view.container.querySelector('[data-hand-seat="1"]')!;
    expect(far.firstElementChild?.getAttribute("data-hand-id")).toBe("lab-1-4");
  });
});
