// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PriorityChips, priorityOrder } from "@/components/duel/priority-chips";

afterEach(cleanup);

const seats = [{ seat: 0 }, { seat: 1 }, { seat: 2 }];

describe("priorityOrder", () => {
  it("opens with the turn player and goes clockwise", () => {
    expect(priorityOrder(seats, 1, [{ seat: 0 }], null).map((slot) => slot.seat)).toEqual([1, 2, 0]);
  });

  it("opens with the next seat when the turn player made the last link", () => {
    expect(priorityOrder(seats, 1, [{ seat: 0 }, { seat: 1 }], null).map((slot) => slot.seat)).toEqual([2, 0, 1]);
  });

  it("skips a seat that left, and starts after a turn player who left", () => {
    const left = [{ seat: 0 }, { seat: 1, eliminated: true }, { seat: 2 }];
    expect(priorityOrder(left, 0, [{ seat: 2 }], null).map((slot) => slot.seat)).toEqual([0, 2]);
    expect(priorityOrder(left, 1, [{ seat: 0 }], null).map((slot) => slot.seat)).toEqual([2, 0]);
  });

  it("skips a seat that is leaving, also when it is the turn player", () => {
    const leaving = [{ seat: 0 }, { seat: 1, pendingElimination: true }, { seat: 2 }];
    expect(priorityOrder(leaving, 0, [{ seat: 2 }], null).map((slot) => slot.seat)).toEqual([0, 2]);
    expect(priorityOrder(leaving, 1, [{ seat: 0 }], null).map((slot) => slot.seat)).toEqual([2, 0]);
  });

  it("lights the seat that is choosing", () => {
    const order = priorityOrder(seats, 0, [{ seat: 1 }], 2);
    expect(order.filter((slot) => slot.choosing).map((slot) => slot.seat)).toEqual([2]);
  });
});

describe("PriorityChips", () => {
  it("keeps the seat number visible for duplicate compact responder names", () => {
    const { getByTestId } = render(<PriorityChips order={priorityOrder(seats, 0, [{ seat: 2 }], 1)}
      mySeat={0} nameOf={(seat) => seat === 0 ? "Alice" : `Practice Bot (seat ${seat + 1})`} compact />);
    const chips = [...getByTestId("priority-chips").querySelectorAll("[data-seat]")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["You", "Practice Bot (seat 2)", "Practice Bot (seat 3)"]);
  });

  it("names each seat in order, says You for the viewer and marks who is choosing", () => {
    const names = ["Ren", "Mika", "Ryo"];
    const { getByTestId } = render(
      <PriorityChips order={priorityOrder(seats, 1, [{ seat: 0 }], 0)} mySeat={0} nameOf={(seat) => names[seat]} seatTones={new Map([[0, { main: "#fff", ink: "#eee" }]])} />,
    );
    const node = getByTestId("priority-chips");
    expect(node.textContent).toBe("PriorityMikaRyoYou · choosing");
  });
});
