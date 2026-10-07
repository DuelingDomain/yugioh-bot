// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxTableView, tablePlaces, type SandboxTableViewProps } from "@/components/sandbox/table-view";
import { boardReducer, createBuilderState, type SandboxBuilderState } from "@/components/sandbox/board-model";
import type { SeatBoardActions } from "@/components/sandbox/seat-board";

afterEach(() => cleanup());

function actions(over: Partial<SeatBoardActions> = {}): SeatBoardActions {
  return {
    act: vi.fn(() => true),
    onSlot: vi.fn(),
    onDropOnLoc: vi.fn(),
    onSelectTarget: vi.fn(),
    onAddArmedToPile: vi.fn(),
    onOpen: vi.fn(),
    onAddMaterialByName: vi.fn(async () => null),
    ...over,
  };
}

function view(state: SandboxBuilderState, over: Partial<SandboxTableViewProps> = {}) {
  const acts = actions();
  const result = render(<SandboxTableView state={state} infos={new Map()} armedCode={null} target="hand" open={null} actions={acts} {...over} />);
  return { acts, ...result };
}

const tile = (seat: string) => document.querySelector<HTMLElement>(`[data-seat-tile="${seat}"]`)!;
const num = (el: HTMLElement, key: string) => Number(el.dataset[key]);

describe("tablePlaces", () => {
  it("puts the 3-way seats in the plaza: you at the bottom, the rivals up left and up right and turned", () => {
    const places = tablePlaces(createBuilderState("ffa3"));
    const by = Object.fromEntries(places.map((p) => [p.seat, p]));
    expect(places.map((p) => p.seat)).toEqual(["p0", "p1", "p2"]);
    expect(by.p0.y).toBeGreaterThan(by.p1.y);
    expect(by.p1.x).toBeLessThan(by.p0.x);
    expect(by.p2.x).toBeGreaterThan(by.p0.x);
    expect(by.p0.rotateDeg).toBe(0);
    expect(by.p1.rotateDeg).toBeGreaterThan(90);
    expect(by.p2.rotateDeg).toBeGreaterThan(180);
    expect(by.p1.scale).toBeLessThan(by.p0.scale);
  });

  it("puts the 4-way seats in the 2x2 grid: 0 bottom left, 1 top left, 2 top right, 3 bottom right", () => {
    const places = tablePlaces(createBuilderState("ffa4"));
    const by = Object.fromEntries(places.map((p) => [p.seat, p]));
    expect(by.p0.place).toBe("bl");
    expect(by.p1.place).toBe("tl");
    expect(by.p2.place).toBe("tr");
    expect(by.p3.place).toBe("br");
    expect(by.p0.x).toBeCloseTo(by.p1.x);
    expect(by.p2.x).toBeCloseTo(by.p3.x);
    expect(by.p3.x).toBeGreaterThan(by.p0.x);
    expect(by.p0.y).toBeGreaterThan(by.p1.y);
    expect([by.p0.rotateDeg, by.p1.rotateDeg, by.p2.rotateDeg, by.p3.rotateDeg]).toEqual([0, 180, 180, 0]);
    // The bottom field of each facing pair draws the shared Extra Monster row.
    expect([by.p0.drawer, by.p1.drawer, by.p2.drawer, by.p3.drawer]).toEqual([true, false, false, true]);
  });

  it("hands the shared row to the top seat when the bottom seat is out", () => {
    const state = { ...createBuilderState("ffa4"), board: { ...createBuilderState("ffa4").board, eliminated: ["p0" as const] } };
    const by = Object.fromEntries(tablePlaces(state).map((p) => [p.seat, p]));
    expect(by.p0.drawer).toBe(false);
    expect(by.p1.drawer).toBe(true);
    expect(by.p3.drawer).toBe(true);
  });
});

describe("SandboxTableView", () => {
  it("draws every seat of a 3-way table with its own Extra Monster Zones", () => {
    view(createBuilderState("ffa3"));
    expect(document.querySelectorAll("[data-seat-tile]")).toHaveLength(3);
    expect(tile("p0").dataset.place).toBe("home");
    expect(num(tile("p0"), "y")).toBeGreaterThan(num(tile("p1"), "y"));
    for (const seat of ["p0", "p1", "p2"]) {
      expect(document.querySelector(`[data-sbx-loc="${seat}:monster:5"]`)).not.toBeNull();
      expect(document.querySelector(`[data-sbx-loc="${seat}:monster:6"]`)).not.toBeNull();
    }
  });

  it("draws the shared Extra Monster Zones of a 4-way table once per facing pair", () => {
    view(createBuilderState("ffa4"));
    expect(document.querySelectorAll("[data-seat-tile]")).toHaveLength(4);
    expect(tile("p0").dataset.drawer).toBe("true");
    expect(tile("p1").dataset.drawer).toBeUndefined();
    // Two zones per pair, drawn by the bottom seat; the top seat has none.
    expect(document.querySelectorAll('[data-sbx-loc$=":monster:5"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-sbx-loc$=":monster:6"]')).toHaveLength(2);
    expect(document.querySelector('[data-sbx-loc="p0:monster:5"]')).not.toBeNull();
    expect(document.querySelector('[data-sbx-loc="p3:monster:5"]')).not.toBeNull();
    expect(document.querySelector('[data-sbx-loc="p1:monster:5"]')).toBeNull();
  });

  it("shows a card that a partner holds in the shared zone, and lets the owner chip pick who an empty zone is for", () => {
    let state = createBuilderState("ffa4");
    state = boardReducer(state, { type: "place", at: { seat: "p1", zone: "monster", index: 5 }, card: 46986414 });
    const { acts } = view(state);
    const cell = document.querySelector<HTMLElement>('[data-sbx-loc="p1:monster:5"]');
    expect(cell).not.toBeNull();
    expect(document.querySelector('[data-sbx-loc="p0:monster:5"]')).toBeNull();
    fireEvent.click(within(cell!).getByRole("button"));
    expect(acts.onSlot).toHaveBeenCalledWith({ seat: "p1", zone: "monster", index: 5 });

    // The empty zone 6 is for p0 until the chip is switched to p1.
    fireEvent.click(screen.getAllByRole("button", { name: /Shared Extra Monster Zones/ })[0]);
    expect(document.querySelector('[data-sbx-loc="p1:monster:6"]')).not.toBeNull();
  });

  it("sends a slot click to the builder with the seat, zone and index", () => {
    const onSelectSeat = vi.fn();
    const { acts } = view(createBuilderState("ffa4"), { onSelectSeat });
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-sbx-loc="p3:spell:2"]')!).getByRole("button"));
    expect(onSelectSeat).toHaveBeenCalledWith("p3");
    expect(acts.onSlot).toHaveBeenCalledWith({ seat: "p3", zone: "spell", index: 2 });
  });

  it("marks an Out seat, refuses its clicks, and still toggles it back In", () => {
    const state = { ...createBuilderState("ffa3"), board: { ...createBuilderState("ffa3").board, eliminated: ["p2" as const] } };
    const onToggleEliminated = vi.fn();
    const { acts } = view(state, { onToggleEliminated });
    expect(tile("p2").dataset.out).toBe("true");
    expect(tile("p2")).toHaveTextContent("Out");
    expect(tile("p1").dataset.out).toBeUndefined();
    const empty = within(document.querySelector<HTMLElement>('[data-sbx-loc="p2:monster:0"]')!).getByRole("button");
    expect(empty).toBeDisabled();
    fireEvent.click(empty);
    expect(acts.onSlot).not.toHaveBeenCalled();
    // The piles of an Out seat are disabled too.
    expect(screen.getByRole("button", { name: /Graveyard of P2/ })).toBeDisabled();

    const switchOf = (seat: string) => screen.getByRole("switch", { name: new RegExp(`^${seat} is`) });
    expect(switchOf("P2")).toHaveAttribute("aria-checked", "false");
    expect(switchOf("P1")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(switchOf("P2"));
    expect(onToggleEliminated).toHaveBeenCalledWith("p2");
    fireEvent.click(switchOf("P0"));
    expect(onToggleEliminated).toHaveBeenLastCalledWith("p0");
  });

  it("disables the In/Out toggle while the model has no toggle action", () => {
    view(createBuilderState("ffa3"));
    expect(screen.getByRole("switch", { name: /^P1 is/ })).toBeDisabled();
  });

  it("shows the seat names and life points in the badge", () => {
    let state = createBuilderState("ffa3");
    state = boardReducer(state, { type: "setLp", seat: "p1", lp: 4000 });
    view(state);
    expect(screen.getByRole("button", { name: /Pick P0/ })).toHaveTextContent(/P0\s*You/);
    expect(screen.getByRole("button", { name: /Pick P1/ })).toHaveTextContent("P1");
    expect(screen.getByLabelText("Life points of P1")).toHaveValue("4000");
    expect(screen.getByLabelText("Life points of P0")).toHaveValue("");
  });

  it("opens a pile in the drawer, picks it as the quick add target, and shows pile counts", () => {
    let state = createBuilderState("ffa4");
    state = boardReducer(state, { type: "paste", seat: "p2", zone: "grave", codes: [1, 2, 3] });
    const onSelectSeat = vi.fn();
    const { acts } = view(state, { onSelectSeat });
    const chip = screen.getByRole("button", { name: /Graveyard of P2, 3 cards/ });
    fireEvent.click(chip);
    expect(onSelectSeat).toHaveBeenCalledWith("p2");
    expect(acts.onSelectTarget).toHaveBeenCalledWith("grave");
    const drawer = screen.getByRole("group", { name: "Pile drawer of P2" });
    expect(within(drawer).getByRole("region", { name: "Graveyard of P2" })).toBeInTheDocument();
    expect(within(drawer).getAllByRole("button", { name: /Open card options/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Close pile" }));
    expect(screen.queryByRole("group", { name: "Pile drawer of P2" })).toBeNull();
  });

  it("draws the popover of an open card in its own layer, not inside the scaled field", () => {
    let state = createBuilderState("ffa3");
    state = boardReducer(state, { type: "place", at: { seat: "p0", zone: "monster", index: 0 }, card: 46986414 });
    view(state, { open: { seat: "p0", zone: "monster", index: 0 } });
    const dialog = screen.getByRole("dialog");
    expect(dialog.closest("[data-seat-tile]")).toBeNull();
    expect(dialog.closest("[data-sbx-slot]")).not.toBeNull();
  });

  it("stacks the seats on a phone", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 360 });
    try {
      view(createBuilderState("ffa4"));
      expect(document.querySelector("[data-layout]")).toHaveAttribute("data-layout", "stack");
      expect(document.querySelectorAll("[data-seat-tile]")).toHaveLength(4);
      // A top seat of the grid says where its Extra Monster Zones are.
      expect(tile("p1")).toHaveTextContent("shared with P0");
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });
});
