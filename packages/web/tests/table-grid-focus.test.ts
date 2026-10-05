import { describe, expect, it } from "vitest";
import { gridFocusReducer, initialGridFocus, seatOfDigit } from "@/components/duel/table/grid-focus";

describe("gridFocusReducer", () => {
  it("starts on the viewer's own field", () => {
    expect(initialGridFocus(2)).toEqual({ seat: 2 });
  });

  it("focuses any seat, and keeps the same state for the same seat", () => {
    const start = initialGridFocus(0);
    expect(gridFocusReducer(start, { type: "focus", seat: 3 })).toEqual({ seat: 3 });
    expect(gridFocusReducer(start, { type: "focus", seat: 0 })).toBe(start);
  });

  it("shows all fields, and a focus after that comes back to a field", () => {
    const all = gridFocusReducer(initialGridFocus(1), { type: "all" });
    expect(all.seat).toBeNull();
    expect(gridFocusReducer(all, { type: "all" })).toBe(all);
    expect(gridFocusReducer(all, { type: "focus", seat: 1 })).toEqual({ seat: 1 });
  });
});

describe("seatOfDigit", () => {
  it("maps keys 1 to 4 to seats 0 to 3, only for seats that have a field", () => {
    expect(seatOfDigit("1", [0, 1, 2, 3])).toBe(0);
    expect(seatOfDigit("4", [0, 1, 2, 3])).toBe(3);
    expect(seatOfDigit("3", [0, 1, 3])).toBeNull();
    expect(seatOfDigit("5", [0, 1, 2, 3])).toBeNull();
    expect(seatOfDigit("a", [0, 1, 2, 3])).toBeNull();
  });
});
