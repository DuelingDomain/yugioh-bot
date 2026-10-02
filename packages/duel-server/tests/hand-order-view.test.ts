import { describe, expect, it } from "vitest";
import { OcgLocation as L, OcgMessageType as M, OcgPosition as P } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import { createEventContext, createRevealMap, moveReveals, noteReveal, observeMoveEvents, projectView, slotRevealed, type StoredDuelEvent } from "../src/views.js";

const cards = { get: (code: number) => ({ code, name: `Card ${code}`, type: 17 }) } as CardDatabase;

describe("hand order in projected views", () => {
  it("keeps reveals on their engine card as removals compact and additions insert", () => {
    const reveals = createRevealMap();
    noteReveal(reveals, 1, 0, L.HAND, 2, 20);
    moveReveals(reveals, { controller: 0, location: L.HAND, sequence: 0 }, { controller: 0, location: L.GRAVE, sequence: 0 }, 10);
    expect(slotRevealed(reveals, 1, 0, L.HAND, 1, 20)).toBe(true);
    moveReveals(reveals, { controller: 0, location: L.GRAVE, sequence: 0 }, { controller: 0, location: L.HAND, sequence: 0 }, 10);
    expect(slotRevealed(reveals, 1, 0, L.HAND, 2, 20)).toBe(true);
  });
  it.each([L.DECK, L.GRAVE, L.REMOVED, L.EXTRA, L.MZONE])("appends a move from %s in normal and Domain views, without exposing hidden shuffle identity", (source) => {
    const ctx = createEventContext();
    const events: StoredDuelEvent[] = [];
    const reveals = createRevealMap();
    events.push(...observeMoveEvents({ type: M.DRAW, player: 0, drawn: [10, 20].map((code) => ({ code, position: P.FACEDOWN_ATTACK })) }, cards, ctx, 1));
    events.push(...observeMoveEvents({ type: M.MOVE, card: 30,
      from: { controller: 0, location: source, sequence: 0, position: P.FACEDOWN_ATTACK },
      to: { controller: 0, location: L.HAND, sequence: 2, position: P.FACEDOWN_ATTACK } }, cards, ctx, 3));
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: [30, 20, 10] }, cards, ctx, 4);
    noteReveal(reveals, 1, 0, L.HAND, 1, 20);
    for (const mode of ["normal", "domain"] as const) {
      const project = (viewer: number | null) => projectView({
        lib: { duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
          duelQueryLocation: (_h: unknown, q: { controller: number; location: number }) => q.controller === 0 && q.location === L.HAND
            ? [30, 20, 10].map((code) => ({ code, position: P.FACEDOWN_ATTACK })) : [] } as never,
        handle: {} as never, cards, viewer, revision: 1, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
        prompt: { id: "action", seat: 0, kind: "choice", title: "Play", options: [{ id: "summon:0", label: "Summon", controller: 0, location: L.HAND, sequence: 0, card: cards.get(30) }] },
        promptSeat: 0, log: [], events, result: null, reveals, mode, handOrder: ctx.handOrder,
      });
      const own = project(0);
      expect(own.seats[0]!.hand.map((c) => [c.code, c.sequence])).toEqual([[10, 2], [20, 1], [30, 0]]);
      expect(own.events[2]!.handId).toBe(own.seats[0]!.hand[2]!.handId);
      expect(own.prompt!.options[0]!.sequence).toBe(own.seats[0]!.hand[2]!.sequence);
      expect(project(null).seats[0]!.hand.map((c) => c.code)).toEqual([undefined, undefined, undefined]);
      expect(project(1).seats[0]!.hand.map((c) => c.code)).toEqual([undefined, 20, undefined]);
      expect(project(null).events[2]!.handId).toBe(project(null).seats[0]!.hand[2]!.handId);
      expect(project(null).seats[0]!.hand.map((c) => c.handId)).not.toEqual(own.seats[0]!.hand.map((c) => c.handId));
      expect(project(0)).toEqual(own); // reads and replay snapshots never mutate order
    }
  });
});
