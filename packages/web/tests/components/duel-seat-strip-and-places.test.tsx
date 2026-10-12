// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelFormat, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { MultiSeatStage } from "@/components/duel/multi-seat-stage";
import { SeatStrip } from "@/components/duel/seat-strip";
import { promptLegalKeys } from "@/components/duel/prompts";
import { LOCATION_MZONE } from "@/components/duel/constants";
import { seatNamer } from "@/components/duel/multi-seat";

afterEach(cleanup);

const NAMES = ["Ada", "Bo", "Cy", "Di"];

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [], ...extra,
  };
}

function makeEngine(format: DuelFormat, count: number, seatExtra: Record<number, Partial<DuelSeatView>> = {}): DuelEngineView {
  return {
    revision: 1, format, turn: 1, turnSeat: 0, phase: "main1",
    seats: Array.from({ length: count }, (_, seat) => seatView(seat, { team: format === "tag" ? seat % 2 : seat, ...seatExtra[seat] })),
    prompt: null, chain: [], events: [], log: [], result: null,
  };
}

function stage(engine: DuelEngineView, mySeat: number | null, opts: { focusSeat?: number | null; legal?: Set<string>; onActivate?: (...args: unknown[]) => void } = {}) {
  return render(
    <MultiSeatStage engine={engine} mySeat={mySeat} masterRule={4} reducedMotion
      legalKeys={opts.legal ?? new Set()} selectedKeys={new Set()} onActivate={(opts.onActivate ?? vi.fn()) as never}
      onInspect={vi.fn()} nameOf={(seat) => NAMES[seat]} promptSeat={0}
      focusSeat={opts.focusSeat === undefined ? 1 : opts.focusSeat} onFocusSeat={vi.fn()} />,
  );
}

describe("SeatStrip with a direct-attack aim", () => {
  it("does not offer a Leaving seat while a living seat is offered, and offers it when none is living", () => {
    const options = new Map([[1, "opt:0"], [2, "opt:1"]]);
    const { rerender } = render(<SeatStrip engine={makeEngine("ffa4", 4, { 1: { pendingElimination: true } })} mySeat={0}
      nameOf={(seat) => NAMES[seat]} promptSeat={0} pick={{ options, onPick: vi.fn() }} />);
    expect(screen.queryByTestId("seat-strip-pick-1")).toBeNull();
    expect(screen.getByTestId("seat-strip-pick-2")).toBeTruthy();
    rerender(<SeatStrip engine={makeEngine("ffa4", 4, { 1: { pendingElimination: true }, 2: { pendingElimination: true } })} mySeat={0}
      nameOf={(seat) => NAMES[seat]} promptSeat={0} pick={{ options, onPick: vi.fn() }} />);
    expect(screen.getByTestId("seat-strip-pick-1")).toBeTruthy();
    expect(screen.getByTestId("seat-strip-pick-2")).toBeTruthy();
  });

  it("shows the pick as a button with an aria label and keeps the focus buttons for other seats", () => {
    const engine = makeEngine("ffa4", 4);
    const onPick = vi.fn();
    render(<SeatStrip engine={engine} mySeat={0} nameOf={(seat) => NAMES[seat]} promptSeat={0} focusSeat={1} onFocusSeat={vi.fn()}
      pick={{ options: new Map([[2, "opt:0"]]), onPick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Cy as the opponent" }));
    expect(onPick).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "Show Bo on the main field" })).toBeTruthy();
  });
});

describe("a place prompt on an opponent field", () => {
  const place = (seat: number): DuelPrompt => ({
    id: "p2", seat: 0, kind: "places", title: "Select a zone", min: 1, max: 1,
    options: [{ id: "place:0", label: "z", controller: seat, location: LOCATION_MZONE, sequence: 2 }],
  });

  it("shows the selectable zone on that opponent's compact board and expands it", () => {
    const onActivate = vi.fn();
    const prompt = place(3);
    stage(makeEngine("ffa4", 4), 0, { legal: promptLegalKeys(prompt), onActivate, focusSeat: 1 });
    const board = screen.getByTestId("seat-board-3");
    expect(board.getAttribute("data-expanded")).toBe("true");
    const cell = within(board).getByRole("button", { name: "Di monster zone 3, selectable" });
    expect(cell.closest("[data-legal]")?.getAttribute("data-legal")).toBe("true");
    expect(screen.getByTestId("seat-board-2").getAttribute("data-expanded")).toBe("false");
    fireEvent.click(cell);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect((onActivate.mock.calls[0]![0] as string[])).toContain(`3:${LOCATION_MZONE}:2`);
  });

  it("shows the selectable zone on the focused opponent's field band", () => {
    const prompt = place(1);
    const { container } = stage(makeEngine("ffa4", 4), 0, { legal: promptLegalKeys(prompt), focusSeat: 1 });
    const legal = [...container.querySelectorAll('[data-legal="true"]')].map((node) => node.getAttribute("data-zones") ?? "");
    expect(legal.some((zones) => zones.split(" ").includes(`1:${LOCATION_MZONE}:2`))).toBe(true);
    // No compact board of another seat is lit by it.
    expect(screen.getByTestId("seat-board-2").querySelector('[data-legal="true"]')).toBeNull();
  });
});

describe("seatNamer", () => {
  it("keeps unique names and numbers shared ones", () => {
    const name = seatNamer([{ seat: 0, displayName: "Ada" }, { seat: 1, displayName: "Bot" }, { seat: 2, displayName: " bot" }]);
    expect(name(0)).toBe("Ada");
    expect(name(1)).toBe("Bot (seat 2)");
    expect(name(2)).toBe(" bot (seat 3)");
    expect(name(5)).toBe("Player 6");
  });
});
