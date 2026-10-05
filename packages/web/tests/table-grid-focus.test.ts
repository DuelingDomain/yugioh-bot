import { describe, expect, it } from "vitest";
import { gridFocusReducer, initialGridFocus, seatOfDigit } from "@/components/duel/table/grid-focus";
import { ZOOM_MUL_MAX } from "@/components/duel/table/grid-layout";

describe("gridFocusReducer", () => {
  it("starts zoomed on the viewer's own field", () => {
    expect(initialGridFocus(2)).toEqual({ seat: 2, mul: 1, last: 2 });
  });

  it("focuses any seat and resets the +/- zoom", () => {
    const zoomed = gridFocusReducer(initialGridFocus(0), { type: "zoomIn" });
    expect(zoomed.mul).toBeGreaterThan(1);
    expect(gridFocusReducer(zoomed, { type: "focus", seat: 3 })).toEqual({ seat: 3, mul: 1, last: 3 });
  });

  it("shows all fields, and zooming in from there comes back to the last field", () => {
    const all = gridFocusReducer(initialGridFocus(1), { type: "all" });
    expect(all.seat).toBeNull();
    expect(gridFocusReducer(all, { type: "all" })).toBe(all);
    expect(gridFocusReducer(all, { type: "zoomIn" })).toEqual({ seat: 1, mul: 1, last: 1 });
    expect(gridFocusReducer(all, { type: "zoomOut" })).toBe(all);
  });

  it("zooms in up to a limit, and out far enough shows all fields", () => {
    let state = initialGridFocus(0);
    for (let i = 0; i < 20; i += 1) state = gridFocusReducer(state, { type: "zoomIn" });
    expect(state.mul).toBe(ZOOM_MUL_MAX);
    for (let i = 0; i < 20 && state.seat != null; i += 1) state = gridFocusReducer(state, { type: "zoomOut" });
    expect(state.seat).toBeNull();
    expect(state.last).toBe(0);
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
