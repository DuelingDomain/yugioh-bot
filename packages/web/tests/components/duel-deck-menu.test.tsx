// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelEngineView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("@/components/duel/fx3d/loader", () => ({ loadFx3d: async () => null }));

import { DuelField } from "@/components/duel/field";
import { newBoard } from "@/components/duel/fx-lab/board";
import { DeckSurrenderContext, deckMenuOptions, deckOffersSurrender, type DeckSurrenderValue } from "@/components/duel/deck-surrender";
import { SurrenderModal } from "@/components/duel/surrender-modal";
import { resetPhaseBeats } from "@/components/duel/phase-beats";

beforeAll(() => {
  HTMLElement.prototype.getAnimations = () => [];
});
afterEach(() => { cleanup(); resetPhaseBeats(); vi.useRealTimers(); });

function view(extra: Partial<DuelEngineView> = {}): DuelEngineView {
  return { revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats: newBoard().seats,
    prompt: null, chain: [], events: [], log: [], result: null, ...extra };
}
function table(surrender: Partial<DeckSurrenderValue> = {}, engine = view(), legal: string[] = []) {
  const value: DeckSurrenderValue = { seat: 0, available: true, busy: false, onSurrender: vi.fn(), ...surrender };
  const onActivate = vi.fn();
  const ui = (v: DeckSurrenderValue) => (
    <DeckSurrenderContext.Provider value={v}>
      <DuelField engine={engine} mySeat={0} masterRule={5} reducedMotion
        legalKeys={new Set(legal)} selectedKeys={new Set()} onActivate={onActivate} onInspect={() => {}}
        bottomName="Yugi" topName="Kaiba" />
    </DeckSurrenderContext.Provider>
  );
  return { value, onActivate, ui, ...render(ui(value)) };
}
const deck = (container: HTMLElement, side: "top" | "bottom") =>
  container.querySelector<HTMLElement>(`[data-field-seat][data-side="${side}"] [data-kind="deck"] button`)!;

describe("deck menu", () => {
  it("opens on click of your own deck and offers Surrender", () => {
    const { container } = table();
    fireEvent.click(deck(container, "bottom"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Surrender" })).toBeTruthy();
  });

  it("opens on right click and on a touch long press", () => {
    vi.useFakeTimers();
    const { container } = table();
    fireEvent.contextMenu(deck(container, "bottom"));
    expect(screen.getByRole("menu")).toBeTruthy();
    cleanup();
    const second = table();
    const button = deck(second.container, "bottom");
    fireEvent.pointerDown(button, { pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(499); });
    expect(screen.queryByRole("menu")).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("does not open on a short touch", () => {
    vi.useFakeTimers();
    const { container } = table();
    const button = deck(container, "bottom");
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.pointerUp(button, { pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("never shows Surrender on the opponent's deck", () => {
    const { container, value } = table();
    fireEvent.click(deck(container, "top"));
    fireEvent.contextMenu(deck(container, "top"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(value.onSurrender).not.toHaveBeenCalled();
  });

  it("shows no menu for a spectator or when surrender is closed (duel over)", () => {
    const spectator = table({ seat: null });
    fireEvent.click(deck(spectator.container, "bottom"));
    expect(screen.queryByRole("menu")).toBeNull();
    cleanup();
    const over = table({ available: false });
    fireEvent.click(deck(over.container, "bottom"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the open menu when the duel ends", () => {
    const open = table();
    fireEvent.click(deck(open.container, "bottom"));
    expect(screen.getByRole("menu")).toBeTruthy();
    open.rerender(open.ui({ ...open.value, available: false }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("asks the room to open its confirm when Surrender is chosen", () => {
    const { container, value } = table();
    fireEvent.click(deck(container, "bottom"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Surrender" }));
    expect(value.onSurrender).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and gives focus back to the deck", () => {
    const { container, value } = table();
    const button = deck(container, "bottom");
    button.focus();
    fireEvent.click(button);
    const item = screen.getByRole("menuitem", { name: "Surrender" });
    expect(document.activeElement).toBe(item);
    fireEvent.keyDown(item, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(value.onSurrender).not.toHaveBeenCalled();
  });

  it("keeps the deck's one-click action when the deck is usable", () => {
    const first = table();
    const key = deck(first.container, "bottom").closest<HTMLElement>("[data-zones]")!.dataset.zones!;
    cleanup();
    const { container, onActivate } = table({}, view(), [key]);
    fireEvent.click(deck(container, "bottom"));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0]).toEqual([key]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers the deck's action and Surrender together on right click when the deck is usable", () => {
    const first = table();
    const key = deck(first.container, "bottom").closest<HTMLElement>("[data-zones]")!.dataset.zones!;
    cleanup();
    const { container, onActivate, value } = table({}, view(), [key]);
    fireEvent.contextMenu(deck(container, "bottom"));
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Use Main Deck", "Surrender"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Use Main Deck" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0]).toEqual([key]);
    expect(value.onSurrender).not.toHaveBeenCalled();
  });

  it("opens the menu on a long press when the deck is usable", () => {
    vi.useFakeTimers();
    const first = table();
    const key = deck(first.container, "bottom").closest<HTMLElement>("[data-zones]")!.dataset.zones!;
    cleanup();
    const { container } = table({}, view(), [key]);
    fireEvent.pointerDown(deck(container, "bottom"), { pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole("menuitem", { name: "Use Main Deck" })).toBeTruthy();
  });

  it("clears a selected deck on click, and the menu does not offer Use Main Deck for it", () => {
    const first = table();
    const key = deck(first.container, "bottom").closest<HTMLElement>("[data-zones]")!.dataset.zones!;
    cleanup();
    const onActivate = vi.fn();
    const { container } = render(
      <DeckSurrenderContext.Provider value={{ seat: 0, available: true, busy: false, onSurrender: vi.fn() }}>
        <DuelField engine={view()} mySeat={0} masterRule={5} reducedMotion legalKeys={new Set()}
          selectedKeys={new Set([key])} onActivate={onActivate} onInspect={() => {}} bottomName="Yugi" topName="Kaiba" />
      </DeckSurrenderContext.Provider>,
    );
    fireEvent.click(deck(container, "bottom"));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(deck(container, "bottom"));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Surrender"]);
  });

  it("disables the rows while the room is busy", () => {
    const { container, value } = table({ busy: true });
    fireEvent.click(deck(container, "bottom"));
    const item = screen.getByRole("menuitem", { name: "Surrender" }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    fireEvent.click(item);
    expect(value.onSurrender).not.toHaveBeenCalled();
  });

  it("cancels a long press when the finger drifts more than 8px", () => {
    vi.useFakeTimers();
    const { container } = table();
    const button = deck(container, "bottom");
    fireEvent.pointerDown(button, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(button, { pointerType: "touch", clientX: 104, clientY: 103 });
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.pointerMove(button, { pointerType: "touch", clientX: 100, clientY: 110 });
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole("menu")).toBeNull();
  });


  it("keeps a long press that drifts less than 8px", () => {
    vi.useFakeTimers();
    const { container } = table();
    const button = deck(container, "bottom");
    fireEvent.pointerDown(button, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(button, { pointerType: "touch", clientX: 104, clientY: 103 });
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("does not claim a pressed state on a deck that opens a menu", () => {
    const { container } = table();
    expect(deck(container, "bottom").hasAttribute("aria-pressed")).toBe(false);
    expect(deck(container, "top").hasAttribute("aria-pressed")).toBe(true);
  });
});

describe("deck menu model", () => {
  it("offers Surrender only on your own deck while surrender is open", () => {
    const open: DeckSurrenderValue = { seat: 1, available: true, busy: false, onSurrender: () => {} };
    expect(deckOffersSurrender(open, 1)).toBe(true);
    expect(deckOffersSurrender(open, 0)).toBe(false);
    expect(deckOffersSurrender({ ...open, available: false }, 1)).toBe(false);
    expect(deckOffersSurrender({ ...open, seat: null }, 1)).toBe(false);
    expect(deckOffersSurrender(null, 1)).toBe(false);
  });

  it("lists the deck action before Surrender", () => {
    expect(deckMenuOptions(false).map((option) => option.id)).toEqual(["surrender"]);
    expect(deckMenuOptions(true).map((option) => option.id)).toEqual(["deck_use", "surrender"]);
  });
});

describe("surrender confirm", () => {
  it("asks 'Are you sure?', confirms with Surrender and backs out with Cancel", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<SurrenderModal open busy={false} onClose={onClose} onConfirm={onConfirm} />);
    const dialog = screen.getByRole("dialog", { name: "Surrender" });
    expect(dialog.textContent).toContain("Are you sure?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Surrender" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("also asks if you are sure at a free-for-all table", () => {
    render(<SurrenderModal open busy={false} multiplayer onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Surrender" }).textContent).toContain("Are you sure?");
  });
});