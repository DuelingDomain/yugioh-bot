import { describe, expect, it } from "vitest";
import { OcgLocation as L, OcgMessageType as M, OcgPosition as P } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import { createEventContext, createRevealMap, moveReveals, noteReveal, observeMoveEvents, projectView, slotRevealed, type StoredDuelEvent } from "../src/views.js";

const cards = { get: (code: number) => ({ code, name: `Card ${code}`, type: 17 }) } as CardDatabase;

describe("hand order in projected views", () => {
  it.each([L.DECK, L.GRAVE, L.REMOVED, L.EXTRA, L.MZONE])("uses raw engine slots after every middle insertion, re-sequence and departure from %s", (source) => {
    const ctx = createEventContext();
    const events: StoredDuelEvent[] = [];
    let raw = [10, 20, 40];
    const feed = (message: Parameters<typeof observeMoveEvents>[0]) => events.push(...observeMoveEvents(message, cards, ctx, events.length + 1));
    const project = (viewer: number | null, metadata = true) => projectView({
      lib: { duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
        duelQueryLocation: (_h: unknown, q: { controller: number; location: number }) => q.controller === 0 && q.location === L.HAND
          ? raw.map((code) => ({ code, position: P.FACEDOWN_ATTACK })) : [] } as never,
      handle: {} as never, cards, viewer, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
      prompt: null, promptSeat: null, log: [], events, result: null, reveals: createRevealMap(), mode: "normal",
      handIdentities: metadata ? ctx.handIdentities : undefined,
    });
    const check = () => {
      for (const viewer of [0, 1, null]) {
        const view = project(viewer);
        expect(view.seats[0]!.hand.map((c) => c.sequence)).toEqual(raw.map((_, i) => i));
        expect(view.seats[0]!.hand.map((c) => c.code)).toEqual(raw.map((code) => viewer === 0 ? code : undefined));
      }
    };
    feed({ type: M.DRAW, player: 0, drawn: raw.map((code) => ({ code, position: P.FACEDOWN_ATTACK })) });
    check();
    feed({ type: M.MOVE, card: 30,
      from: { controller: 0, location: source, sequence: 0, position: P.FACEDOWN_ATTACK },
      to: { controller: 0, location: L.HAND, sequence: 1, position: P.FACEDOWN_ATTACK } });
    raw = [10, 30, 20, 40]; check();
    const arrival = project(0).events.at(-1)!;
    expect(arrival.zone?.sequence).toBe(1);
    expect(arrival.handId).toBe(project(0).seats[0]!.hand[1]?.handId);
    raw = [40, 10, 30, 20];
    feed({ type: M.SHUFFLE_HAND, player: 0, cards: raw }); check();
    expect(project(0).events.at(-1)!.handId).toBe(arrival.handId);
    expect(project(0).seats[0]!.hand.find((c) => c.handId === arrival.handId)?.sequence).toBe(2);
    expect(project(0).events.at(-1)!.zone?.sequence).toBe(1); // immutable engine message history
    feed({ type: M.MOVE, card: 40,
      from: { controller: 0, location: L.HAND, sequence: 0, position: P.FACEDOWN_ATTACK },
      to: { controller: 0, location: L.GRAVE, sequence: 0, position: P.FACEUP_ATTACK } });
    raw = [10, 30, 20]; check();
    expect(project(0).seats[0]!.hand.find((c) => c.handId === arrival.handId)?.sequence).toBe(1);
    // Recovery views without animation metadata still contain exactly the engine hand.
    expect(project(0, false).seats[0]!.hand.map((c) => [c.code, c.sequence])).toEqual([[10, 0], [30, 1], [20, 2]]);
    expect(project(0)).toEqual(project(0));
  });

  it("never filters engine cards when identity metadata is incomplete", () => {
    const ctx = createEventContext();
    const view = projectView({
      lib: { duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
        duelQueryLocation: (_h: unknown, q: { controller: number; location: number }) => q.controller === 0 && q.location === L.HAND
          ? [30, 10, 20].map((code) => ({ code, position: P.FACEDOWN_ATTACK })) : [] } as never,
      handle: {} as never, cards, viewer: 0, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
      prompt: null, promptSeat: null, log: [], events: [], result: null, reveals: createRevealMap(), mode: "normal", handIdentities: ctx.handIdentities,
    });
    expect(view.seats[0]!.hand.map((c) => [c.code, c.sequence])).toEqual([[30, 0], [10, 1], [20, 2]]);
  });
  it("keeps reveals on their engine card as removals compact and additions insert", () => {
    const reveals = createRevealMap();
    noteReveal(reveals, 1, 0, L.HAND, 2, 20);
    moveReveals(reveals, { controller: 0, location: L.HAND, sequence: 0 }, { controller: 0, location: L.GRAVE, sequence: 0 }, 10);
    expect(slotRevealed(reveals, 1, 0, L.HAND, 1, 20)).toBe(true);
    moveReveals(reveals, { controller: 0, location: L.GRAVE, sequence: 0 }, { controller: 0, location: L.HAND, sequence: 0 }, 10);
    expect(slotRevealed(reveals, 1, 0, L.HAND, 2, 20)).toBe(true);
  });
  it.each([L.DECK, L.GRAVE, L.REMOVED, L.EXTRA, L.MZONE])("projects a move from %s in engine order after a shuffle, without exposing hidden shuffle identity", (source) => {
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
        promptSeat: 0, log: [], events, result: null, reveals, mode, handIdentities: ctx.handIdentities,
      });
      const own = project(0);
      expect(own.seats[0]!.hand.map((c) => [c.code, c.sequence])).toEqual([[30, 0], [20, 1], [10, 2]]);
      expect(own.events[2]!.handId).toBe(own.seats[0]!.hand[0]!.handId);
      expect(own.prompt!.options[0]!.sequence).toBe(own.seats[0]!.hand[0]!.sequence);
      expect(project(null).seats[0]!.hand.map((c) => c.code)).toEqual([undefined, undefined, undefined]);
      expect(project(1).seats[0]!.hand.map((c) => c.code)).toEqual([undefined, 20, undefined]);
      expect(project(null).events[2]!.handId).toBe(project(null).seats[0]!.hand[2]!.handId);
      expect(project(null).seats[0]!.hand.map((c) => c.handId)).not.toEqual(own.seats[0]!.hand.map((c) => c.handId));
      expect(project(0)).toEqual(own); // reads and replay snapshots never mutate order
    }
  });
});
