import { describe, expect, it } from "vitest";
import { DUEL_FORMATS, seatCountFor, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import { createRevealMap, projectView } from "../src/views.js";

function project(format: DuelFormat, mode: DuelMode, viewer: number | null, eliminated = new Set<number>(), leaving = new Set<number>(), ffa4SharedExtraZones = true) {
  const count = seatCountFor(format);
  return projectView({
    lib: {
      duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
      duelQueryCount: () => 30,
      duelQueryLocation: (_handle: unknown, { controller, location }: { controller: number; location: number }) => {
        if (location === OcgLocation.MZONE) return [...Array(5).fill(null), { code: 100 + controller, position: OcgPosition.FACEUP_ATTACK }, null];
        if (location === OcgLocation.HAND) return [{ code: 200 + controller, position: OcgPosition.FACEDOWN }];
        return [];
      },
    } as never,
    handle: {} as never,
    cards: { get: (code: number) => ({ code, name: `Card ${code}` }), resolveLabel: () => "" } as never,
    viewer, revision: 1, turn: 1, turnSeat: 0, phase: "main1",
    lp: Array.from({ length: count }, () => 8000), prompt: null, promptSeat: null,
    log: [], events: [], result: null, reveals: createRevealMap(count), mode, format, eliminated, leaving,
    coreCapabilities: { ffa4SharedExtraZones },
  });
}

describe.each<DuelMode>(["normal", "domain"])("%s shared EMZ seat view", (mode) => {
  it("keeps separate zones on a core without C6", () => {
    for (const viewer of [0, 1, 2, 3, null]) {
      const view = project("ffa4", mode, viewer, new Set(), new Set(), false);
      expect(view.seats.map((seat) => seat.sharedExtraWith)).toEqual([null, null, null, null]);
      expect(view.seats.map((seat) => seat.monsters[5]?.controller)).toEqual([0, 1, 2, 3]);
    }
  });

  it.each(DUEL_FORMATS)("publishes each seat's sharedExtraWith in %s", (format) => {
    const view = project(format, mode, 0);
    expect(view.seats.map((seat) => seat.sharedExtraWith))
      .toEqual(format === "ffa4" ? [2, 3, 0, 1] : Array(seatCountFor(format)).fill(null));
    expect(view.seats.map((seat) => seat.monsters[5]?.controller)).toEqual(Array.from({ length: seatCountFor(format) }, (_, seat) => seat));
  });

  it("publishes the same pairing for every player and spectators without sharing hidden cards", () => {
    for (const viewer of [0, 1, 2, 3, null]) {
      const view = project("ffa4", mode, viewer);
      expect(view.seats.map((seat) => seat.sharedExtraWith)).toEqual([2, 3, 0, 1]);
      expect(view.seats.map((seat) => seat.hand[0]?.code)).toEqual([0, 1, 2, 3].map((seat) => seat === viewer ? 200 + seat : undefined));
    }
  });

  it("clears both ends of a pair after elimination and keeps the other pair", () => {
    for (const lost of [0, 1, 2, 3]) {
      const view = project("ffa4", mode, 0, new Set([lost]));
      expect(view.seats.map((seat) => seat.sharedExtraWith))
        .toEqual([0, 1, 2, 3].map((seat) => seat === lost || seat === (lost + 2) % 4 ? null : (seat + 2) % 4));
      expect(view.seats[lost]).toMatchObject({ eliminated: true, sharedExtraWith: null, hand: [], deckCount: 0 });
      expect(view.seats[lost]!.monsters.every((card) => card === null)).toBe(true);
    }
  });

  it("keeps the pair while an elimination waits for the core", () => {
    const view = project("ffa4", mode, 0, new Set(), new Set([2]));
    expect(view.seats.map((seat) => seat.sharedExtraWith)).toEqual([2, 3, 0, 1]);
    expect(view.seats[2]).toMatchObject({ pendingElimination: true, eliminated: false });
  });
});
