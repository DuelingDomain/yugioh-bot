// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelSeatView } from "@yugidraft/shared/duels";
import { SeatStrip } from "@/components/duel/seat-strip";
import { nextSeatAfter } from "@/components/duel/multi-seat";

afterEach(cleanup);

const NAMES = ["Ada", "Bo", "Cy", "Di"];

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [], team: seat, ...extra,
  };
}

function engine(turnSeat: number, extra: Record<number, Partial<DuelSeatView>> = {}): DuelEngineView {
  return {
    revision: 1, format: "ffa4", turn: 1, turnSeat, phase: "main1",
    seats: [0, 1, 2, 3].map((seat) => seatView(seat, extra[seat])),
    prompt: null, chain: [], events: [], log: [], result: null,
  };
}

const strip = (view: DuelEngineView, promptSeat: number | null = null) =>
  render(<SeatStrip engine={view} mySeat={0} nameOf={(seat) => NAMES[seat]} promptSeat={promptSeat} />);
const text = (seat: number) => screen.getByTestId(`seat-strip-${seat}`).textContent ?? "";

describe("nextSeatAfter with leaving seats", () => {
  it("skips leaving and eliminated seats", () => {
    const view = engine(0, { 1: { pendingElimination: true }, 2: { eliminated: true } });
    expect(nextSeatAfter(view.seats, 0)).toBe(3);
    expect(nextSeatAfter(view.seats, 3)).toBe(0);
  });

  it("returns null when every other seat is out or leaving", () => {
    const view = engine(0, { 1: { pendingElimination: true }, 2: { eliminated: true }, 3: { pendingElimination: true } });
    expect(nextSeatAfter(view.seats, 0)).toBeNull();
  });
});

describe("SeatStrip with a leaving seat", () => {
  it("shows only Leaving for a leaving seat that is the turn seat, the next seat or answering", () => {
    strip(engine(1, { 1: { pendingElimination: true } }), 1);
    expect(text(1)).toContain("Leaving");
    expect(text(1)).not.toMatch(/To play|Next|Choosing/);
    expect(screen.getByTestId("seat-strip-1").getAttribute("data-turn")).toBe("false");
    expect(screen.getByTestId("seat-strip-1").getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("seat-strip-1").getAttribute("data-answering")).toBe("false");
    cleanup();
    strip(engine(0, { 1: { pendingElimination: true } }));
    expect(text(1)).toContain("Leaving");
    expect(text(1)).not.toMatch(/To play|Next/);
    expect(screen.getByTestId("seat-strip-1").getAttribute("data-next")).toBe("false");
  });

  it("gives Next to the next living seat after the turn seat", () => {
    strip(engine(0, { 1: { pendingElimination: true } }));
    expect(text(2)).toContain("Next");
    expect(screen.getByTestId("seat-strip-2").getAttribute("data-next")).toBe("true");
  });

  it("shows Eliminated, not Leaving, for an eliminated seat", () => {
    strip(engine(0, { 1: { eliminated: true, pendingElimination: true } }));
    expect(text(1)).toContain("Eliminated");
    expect(text(1)).not.toContain("Leaving");
  });

  it("does not make a leaving seat pickable while a living seat is offered", () => {
    const options = new Map([[1, "opt:0"], [2, "opt:1"]]);
    render(<SeatStrip engine={engine(0, { 1: { pendingElimination: true } })} mySeat={0} nameOf={(seat) => NAMES[seat]} promptSeat={0}
      pick={{ options, onPick: vi.fn() }} />);
    expect(screen.queryByTestId("seat-strip-pick-1")).toBeNull();
    expect(screen.getByTestId("seat-strip-pick-2")).toBeTruthy();
  });

  it("keeps every offered seat pickable when all of them are leaving", () => {
    const options = new Map([[1, "opt:0"], [2, "opt:1"]]);
    render(<SeatStrip engine={engine(0, { 1: { pendingElimination: true }, 2: { pendingElimination: true } })} mySeat={0}
      nameOf={(seat) => NAMES[seat]} promptSeat={0} pick={{ options, onPick: vi.fn() }} />);
    expect(screen.getByTestId("seat-strip-pick-1")).toBeTruthy();
    expect(screen.getByTestId("seat-strip-pick-2")).toBeTruthy();
  });
});
