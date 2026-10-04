// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { MultiSeatStage } from "@/components/duel/multi-seat-stage";

afterEach(cleanup);

const NAMES = ["Ada", "Bo", "Cy", "Di"];

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [], team: seat, ...extra,
  };
}

function stage(turnSeat: number, extra: Record<number, Partial<DuelSeatView>>) {
  const engine: DuelEngineView = {
    revision: 1, format: "ffa4", turn: 1, turnSeat, phase: "main1",
    seats: [0, 1, 2, 3].map((seat) => seatView(seat, extra[seat])),
    prompt: null, chain: [], events: [], log: [], result: null,
  };
  return render(
    <MultiSeatStage engine={engine} mySeat={0} masterRule={4} reducedMotion legalKeys={new Set()} selectedKeys={new Set()}
      onActivate={vi.fn() as never} onInspect={vi.fn()} nameOf={(seat) => NAMES[seat]} promptSeat={turnSeat} focusSeat={1} onFocusSeat={vi.fn()} />,
  );
}

describe("opponent board of a leaving seat", () => {
  it("shows Leaving, never To play or Choosing, for a leaving turn seat", () => {
    stage(2, { 2: { pendingElimination: true } });
    const board = screen.getByTestId("seat-board-2");
    expect(within(board).getByText("Leaving")).toBeTruthy();
    expect(within(board).queryByText("To play")).toBeNull();
    expect(within(board).queryByText("Choosing")).toBeNull();
    expect(board.getAttribute("data-active")).toBe("false");
    expect(board.getAttribute("data-answering")).toBe("false");
  });

  it("keeps To play and Choosing on a living turn seat", () => {
    stage(2, { 3: { pendingElimination: true } });
    const board = screen.getByTestId("seat-board-2");
    expect(within(board).getByText("To play")).toBeTruthy();
    expect(within(board).getByText("Choosing")).toBeTruthy();
    expect(within(board).queryByText("Leaving")).toBeNull();
  });
});
