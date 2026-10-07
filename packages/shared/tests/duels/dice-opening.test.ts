import { describe, expect, it, vi } from "vitest";
import { newDiceOpening, settleDiceOpening, diceOpeningView } from "../../src/duels/dice-opening.js";
import { parseOpening } from "../../src/duels/opening.js";

function rolls(...values: number[]) {
  return vi.fn(() => {
    const value = values.shift();
    if (value === undefined) throw new Error("Unexpected roll");
    return value;
  });
}

describe("FFA dice opening", () => {
  it("orders all lobby seats by descending rolls and starts at the final reveal deadline", () => {
    const state = newDiceOpening(42, 4, 1000, rolls(3, 1, 6, 4));
    expect(state).toMatchObject({ phase: "dice", round: 1, deadline: 4000, order: [2, 3, 0, 1] });
    expect(state.rounds).toEqual([{ round: 1, rolls: [3, 1, 6, 4] }]);
    expect(settleDiceOpening(state, 3999)).toBe(state);
    expect(settleDiceOpening(state, 4000)).toMatchObject({ phase: "start", deadline: 4000 });
    expect(settleDiceOpening(settleDiceOpening(state, 4000), 9999)).toMatchObject({ phase: "start", deadline: 4000 });
  });

  it("re-rolls only tied seats inside their previous rank", () => {
    const roll = rolls(6, 3, 3, 1, 1, 6);
    const first = newDiceOpening(42, 4, 1000, roll);
    expect(first.order).toBeNull();
    expect(settleDiceOpening(first, 3999, roll)).toBe(first);
    expect(roll).toHaveBeenCalledTimes(4);
    const second = settleDiceOpening(first, 4000, roll);
    expect(second.rounds[1]).toEqual({ round: 2, rolls: [null, 1, 6, null] });
    expect(second.order).toEqual([0, 2, 1, 3]);
    expect(second.deadline).toBe(7000);
    expect(settleDiceOpening(second, 7000, roll).phase).toBe("start");
  });

  it("resolves a three-way tie and a further partial tie", () => {
    const roll = rolls(4, 4, 4, 2, 6, 6, 1, 5);
    const first = newDiceOpening(42, 3, 0, roll);
    const second = settleDiceOpening(first, 3000, roll);
    expect(second.order).toBeNull();
    const third = settleDiceOpening(second, 6000, roll);
    expect(third.rounds).toEqual([
      { round: 1, rolls: [4, 4, 4] },
      { round: 2, rolls: [2, 6, 6] },
      { round: 3, rolls: [null, 1, 5] },
    ]);
    expect(third.order).toEqual([2, 1, 0]);
    expect(settleDiceOpening(third, 9000, roll).phase).toBe("start");
  });

  it("resolves two tied pairs without comparing their new rolls", () => {
    const roll = rolls(5, 5, 2, 2, 1, 2, 6, 5);
    const second = settleDiceOpening(newDiceOpening(42, 4, 0, roll), 3000, roll);
    expect(second.rounds[1]?.rolls).toEqual([1, 2, 6, 5]);
    expect(second.order).toEqual([1, 0, 2, 3]);
  });

  it("gives a late round its full reveal time and keeps the last start deadline", () => {
    const roll = rolls(6, 6, 1, 2, 5);
    const second = settleDiceOpening(newDiceOpening(42, 3, 0, roll), 8000, roll);
    expect(second.deadline).toBe(11000);
    expect(settleDiceOpening(second, 20000)).toMatchObject({ phase: "start", deadline: 11000 });
  });

  it("stores complete rounds and exposes the final seat for each lobby seat to every viewer", () => {
    const state = newDiceOpening(42, 3, 1000, rolls(2, 1, 6));
    expect(parseOpening(JSON.stringify(state))).toEqual(state);
    expect(diceOpeningView(state, 1500)).toEqual({
      phase: "dice", round: 1, serverNow: 1500, deadlineAt: new Date(4000).toISOString(),
      rounds: [{ round: 1, rolls: [2, 1, 6] }], order: [2, 0, 1], finalSeats: [1, 2, 0],
    });
  });

  it("rejects other seat counts and invalid die values", () => {
    expect(() => newDiceOpening(42, 2, 0)).toThrow();
    expect(() => newDiceOpening(42, 4, 0, rolls(0))).toThrow();
    expect(() => newDiceOpening(42, 3, 0, rolls(7))).toThrow();
  });
});
