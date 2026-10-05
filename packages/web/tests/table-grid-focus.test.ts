import { describe, expect, it } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";
import { gridFocusReducer, gridKeyGates, initialGridFocus, seatOfDigit } from "@/components/duel/table/grid-focus";

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

const toggle = (extra: Partial<DuelPrompt> = {}, picked = false): DuelPrompt => ({
  id: "p1",
  seat: 0,
  kind: "toggle",
  title: "Pick materials",
  options: [
    { id: "a", label: "A", selected: picked },
    { id: "b", label: "B" },
  ],
  ...extra,
});
const idle = { viewerSeat: 0, aiming: false, seatKeys: false, flyoutOpen: false };

describe("gridKeyGates", () => {
  it("leaves both keys to the focus when nothing else is open", () => {
    expect(gridKeyGates({ ...idle, prompt: null })).toEqual({ digitsFree: true, escapeFree: true });
  });

  it("gives Esc to a toggle pick that can step back, so Esc is one action and not also 'all fields'", () => {
    // one card picked, no Cancel: Esc is one step back
    expect(gridKeyGates({ ...idle, prompt: toggle({}, true) }).escapeFree).toBe(false);
    // nothing picked, Cancel allowed: Esc cancels
    expect(gridKeyGates({ ...idle, prompt: toggle({ cancelable: true }) }).escapeFree).toBe(false);
    // a forced pick with nothing picked: there is nothing for Esc to do, so the focus may take it
    expect(gridKeyGates({ ...idle, prompt: toggle() }).escapeFree).toBe(true);
  });

  it("gives Esc to a cancelable or finishable prompt of the viewer, not to another seat's prompt", () => {
    expect(gridKeyGates({ ...idle, prompt: toggle({ kind: "cards", cancelable: true }) }).escapeFree).toBe(false);
    expect(gridKeyGates({ ...idle, prompt: toggle({ kind: "cards", finishable: true }) }).escapeFree).toBe(false);
    expect(gridKeyGates({ ...idle, prompt: toggle({ seat: 2, cancelable: true }, true) }).escapeFree).toBe(true);
  });

  it("keeps the digit keys and Esc away from the focus during an attack aim", () => {
    expect(gridKeyGates({ ...idle, prompt: null, aiming: true })).toEqual({ digitsFree: false, escapeFree: false });
  });

  it("keeps the digit keys away from a seat pick, and Esc away from an open flyout", () => {
    expect(gridKeyGates({ ...idle, prompt: null, seatKeys: true }).digitsFree).toBe(false);
    expect(gridKeyGates({ ...idle, prompt: null, flyoutOpen: true }).escapeFree).toBe(false);
  });
});
