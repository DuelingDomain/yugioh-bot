// @vitest-environment jsdom
import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelSeatView } from "@yugidraft/shared/duels";
import { useHudEscape, useHudPane, usePinSync } from "@/components/duel/table/hud-layer";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { useTableUi } from "@/components/duel/table/use-table-ui";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const monster = (sequence: number, attack = 1700): DuelCard => ({
  controller: 0, location: 4, sequence, position: 1, code: 5053103, name: "Battle Ox", attack, defense: 1000, level: 4, type: 1, attribute: 1, race: "Beast-Warrior",
}) as unknown as DuelCard;
const seatWith = (monsters: Array<DuelCard | null>): DuelSeatView[] => [{
  seat: 0, hand: [], extra: [], monsters, spells: [], graveyard: [], banished: [],
}] as unknown as DuelSeatView[];

/** The pin hooks as a shell wires them. */
function useRig(enabled: boolean, seats: DuelSeatView[]) {
  const hud = useHudPane();
  useHudEscape(hud, enabled, false);
  usePinSync(hud, seats);
  return hud;
}

describe("usePinSync", () => {
  it("takes the fresh copy of the card at each revision (stats, counters)", () => {
    const view = renderHook(({ seats }) => useRig(true, seats), { initialProps: { seats: seatWith([monster(2)]) } });
    act(() => view.result.current.pinCard(view.result.current.pinned ?? monster(2)));
    expect(view.result.current.pinned).toMatchObject({ attack: 1700 });
    view.rerender({ seats: seatWith([monster(2, 2400)]) });
    expect(view.result.current.pinned).toMatchObject({ attack: 2400 });
  });

  const inHand = (code: number, sequence: number): DuelCard => ({ ...monster(0), code, location: 2, sequence, name: `Card ${code}` }) as unknown as DuelCard;
  const handOf = (...cards: DuelCard[]): DuelSeatView[] => [{ ...seatWith([])[0], hand: cards }] as unknown as DuelSeatView[];

  describe("a pinned hand card", () => {
    it("stays pinned when an earlier hand card is played and its sequence moves", () => {
      const view = renderHook(({ seats }) => useRig(true, seats), { initialProps: { seats: handOf(inHand(1, 0), inHand(2, 1), inHand(3, 2)) } });
      act(() => view.result.current.pinCard(inHand(3, 2)));
      view.rerender({ seats: handOf(inHand(2, 0), inHand(3, 1)) });
      expect(view.result.current.pinned).toMatchObject({ code: 3, sequence: 1 });
    });

    it("follows the right copy of two copies when the other copy is played", () => {
      const view = renderHook(({ seats }) => useRig(true, seats), { initialProps: { seats: handOf(inHand(7, 0), inHand(2, 1), inHand(7, 2)) } });
      act(() => view.result.current.pinCard(inHand(7, 2)));
      view.rerender({ seats: handOf(inHand(2, 0), inHand(7, 1)) });
      expect(view.result.current.pinned).toMatchObject({ code: 7, sequence: 1 });
    });

    it("lets the pin go when the pinned copy is played and the other copy is far away", () => {
      const view = renderHook(({ seats }) => useRig(true, seats), { initialProps: { seats: handOf(inHand(7, 0), inHand(2, 1), inHand(7, 2)) } });
      act(() => view.result.current.pinCard(inHand(7, 2)));
      view.rerender({ seats: handOf(inHand(7, 0), inHand(2, 1)) });
      expect(view.result.current.pinned).toBeNull();
    });
  });

  it("lets the pin go when the card left its zone or the zone has another card", () => {
    const view = renderHook(({ seats }) => useRig(true, seats), { initialProps: { seats: seatWith([monster(2)]) } });
    act(() => view.result.current.pinCard(monster(2)));
    view.rerender({ seats: seatWith([null, null, null]) });
    expect(view.result.current.pinned).toBeNull();
    act(() => view.result.current.pinCard(monster(2)));
    view.rerender({ seats: seatWith([null, null, { ...monster(2), code: 7 } as DuelCard]) });
    expect(view.result.current.pinned).toBeNull();
  });

  it("keeps the pin object while nothing changed", () => {
    const seats = seatWith([monster(2)]);
    const view = renderHook(() => useRig(true, seats));
    act(() => view.result.current.pinCard(monster(2)));
    const first = view.result.current.pinned;
    view.rerender();
    expect(view.result.current.pinned).toBe(first);
  });
});

describe("useHudEscape", () => {
  it("lets the pin go when the HUD goes (a narrow window), and does not bring it back", () => {
    const seats = seatWith([monster(2)]);
    const view = renderHook(({ enabled }) => useRig(enabled, seats), { initialProps: { enabled: true } });
    act(() => view.result.current.pinCard(monster(2)));
    expect(view.result.current.pinned).not.toBeNull();
    view.rerender({ enabled: false });
    expect(view.result.current.pinned).toBeNull();
    view.rerender({ enabled: true });
    expect(view.result.current.pinned).toBeNull();
  });
});

describe("useTableUi onActivate in the HUD", () => {
  // The spectator state: no prompt for the viewer, so no prompt takes a click on a card.
  const rig = () => {
    const onPinCard = vi.fn();
    const onOpenCard = vi.fn();
    const view = renderHook(() => {
      const base = useFixtureController(FFA4_FIXTURES.states.spectator, { reducedMotion: true });
      return useTableUi(base, { hud: true, onOpenCard, onPinCard });
    });
    const card = FFA4_FIXTURES.states.spectator.room.engine!.seats.flatMap((seat) => seat.monsters).find((slot) => slot != null && slot.code != null)!;
    const anchor = document.createElement("button");
    const keys = [`${card.controller}:${card.location}:${card.sequence}`];
    return { view, card, anchor, keys, onPinCard, onOpenCard };
  };

  it("a click on a card pins it with its anchor", () => {
    const { view, card, anchor, keys, onPinCard, onOpenCard } = rig();
    act(() => view.result.current.controller.onActivate(keys, card, anchor));
    expect(onPinCard).toHaveBeenLastCalledWith(card, anchor);
    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it("a click from the Card flyout or a pile (preserveInspector) opens the flyout and pins nothing", () => {
    const { view, card, anchor, keys, onPinCard, onOpenCard } = rig();
    act(() => view.result.current.controller.onActivate(keys, card, anchor, true));
    expect(onPinCard).not.toHaveBeenCalled();
    expect(onOpenCard).toHaveBeenCalledTimes(1);
  });
});

describe("useTableUi with a new prompt", () => {
  const rig = (promptSeat: number | null) => {
    const onPinCard = vi.fn();
    const first = structuredClone(FFA4_FIXTURES.states.main);
    const next = structuredClone(first);
    next.room.engine!.prompt = { ...next.room.engine!.prompt!, id: "next-prompt", ...(promptSeat != null ? { seat: promptSeat } : null) };
    const view = renderHook(
      ({ state }) => useTableUi(useFixtureController(state, { reducedMotion: true }), { hud: true, onPinCard }),
      { initialProps: { state: first } },
    );
    onPinCard.mockClear();
    view.rerender({ state: next });
    return onPinCard;
  };

  it("lets the pin go when the new prompt is for the viewer's seat", () => {
    expect(rig(null)).toHaveBeenCalledWith(null);
  });

  it("keeps the pin when the new prompt is for another seat", () => {
    expect(rig(1)).not.toHaveBeenCalled();
  });
});
