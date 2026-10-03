import { describe, expect, it } from "vitest";
import { OcgLocation as L, OcgMessageType as M, OcgPosition as P } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import { clearRevealsAt, createEventContext, createRevealMap, moveReveals, noteReveal, observeMoveEvents, projectView, slotRevealed, type StoredDuelEvent } from "../src/views.js";

const cards = { get: (code: number) => ({ code, name: `Card ${code}`, type: 17 }) } as CardDatabase;

/** Compare complete audience view histories while changing only concealed engine codes. */
function concealedHistory(hidden: readonly number[], permutation: readonly number[], removed: number) {
  const ctx = createEventContext();
  const events: StoredDuelEvent[] = [];
  let raw = [...hidden.map((code) => ({ code, isPublic: false })), { code: 30, isPublic: true }];
  const feed = (message: Parameters<typeof observeMoveEvents>[0]) => events.push(...observeMoveEvents(message, cards, ctx, events.length + 1));
  feed({ type: M.DRAW, player: 0, drawn: raw.map(({ code }) => ({ code, position: P.FACEDOWN_ATTACK })) });
  const project = (viewer: number | null) => projectView({
    lib: { duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
      duelQueryLocation: (_h: unknown, q: { controller: number; location: number }) => q.controller === 0 && q.location === L.HAND
        ? raw.map((card) => ({ ...card, position: P.FACEDOWN_ATTACK })) : [] } as never,
    handle: {} as never, cards, viewer, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
    prompt: null, promptSeat: null, log: [], events, result: null, reveals: createRevealMap(), mode: "normal", handIdentities: ctx.handIdentities,
  });
  const snapshot = () => {
    project(0); // Audience identity reconciliation must also be independent of who queries first.
    return [project(1), project(null)];
  };
  const history = [snapshot()];
  raw = permutation.map((index) => raw[index]!);
  feed({ type: M.SHUFFLE_HAND, player: 0, cards: raw.map((card) => card.code) });
  const departing = raw.splice(removed, 1)[0]!;
  feed({ type: M.MOVE, card: departing.code,
    from: { controller: 0, location: L.HAND, sequence: removed, position: P.FACEDOWN_ATTACK },
    to: { controller: 0, location: L.DECK, sequence: 0, position: P.FACEDOWN_ATTACK } });
  history.push(snapshot());
  // A hidden addition and another unobserved shuffle/position change exercise the next batch.
  feed({ type: M.MOVE, card: hidden[0]!,
    from: { controller: 0, location: L.DECK, sequence: 0, position: P.FACEDOWN_ATTACK },
    to: { controller: 0, location: L.HAND, sequence: raw.length, position: P.FACEDOWN_ATTACK } });
  raw.push({ code: hidden[0]!, isPublic: false });
  raw.reverse();
  feed({ type: M.SHUFFLE_HAND, player: 0, cards: raw.map((card) => card.code) });
  feed({ type: M.POS_CHANGE, controller: 0, location: L.HAND, sequence: 0, code: raw[0]!.code,
    prev_position: P.FACEUP_ATTACK, position: P.FACEDOWN_ATTACK });
  history.push(snapshot());
  return history;
}

describe("hand order in projected views", () => {
  it("marks a public arrival's lost correlation identically across hidden worlds", () => {
    const worlds = [[10, 20], [20, 10]].map((shuffled) => {
      const ctx = createEventContext();
      const events = observeMoveEvents({ type: M.DRAW, player: 0, drawn: [{ code: 10, position: P.FACEDOWN_ATTACK }] }, cards, ctx, 1);
      events.push(...observeMoveEvents({ type: M.MOVE, card: 20,
        from: { controller: 0, location: L.GRAVE, sequence: 0, position: P.FACEUP_ATTACK },
        to: { controller: 0, location: L.HAND, sequence: 1, position: P.FACEDOWN_ATTACK } }, cards, ctx, 2));
      observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: shuffled }, cards, ctx, 3);
      events.push(...observeMoveEvents({ type: M.MOVE, card: shuffled[1]!,
        from: { controller: 0, location: L.HAND, sequence: 1, position: P.FACEDOWN_ATTACK },
        to: { controller: 0, location: L.DECK, sequence: 0, position: P.FACEDOWN_ATTACK } }, cards, ctx, 3));
      return [1, null].map((viewer) => projectView({
        lib: { duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
          duelQueryLocation: (_h: unknown, q: { controller: number; location: number }) => q.controller === 0 && q.location === L.HAND
            ? [{ code: shuffled[0], position: P.FACEDOWN_ATTACK, isPublic: false }] : [] } as never,
        handle: {} as never, cards, viewer, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
        prompt: null, promptSeat: null, log: [], events, result: null, reveals: createRevealMap(), mode: "normal", handIdentities: ctx.handIdentities,
      }));
    });
    expect(worlds[0]).toEqual(worlds[1]);
    for (const view of worlds[0]!) {
      expect(view.events[1]).toMatchObject({ handId: "departed-2", handShuffled: true, card: { code: 20 } });
      expect(view.events[2]!.card).toBeUndefined();
    }
  });

  it("does not disclose a hidden copy of a public card after a same-batch shuffle and facedown departure", () => {
    expect(concealedHistory([30, 20], [0, 1, 2], 0)).toEqual(concealedHistory([40, 20], [0, 1, 2], 0));
  });

  it("keeps opponent and spectator view sequences identical under hidden-card substitutions", () => {
    const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const permutation of permutations) for (const removed of [0, 1, 2]) {
      const baseline = concealedHistory([40, 50], permutation, removed);
      for (const first of [10, 20, 30, 40]) for (const second of [10, 20, 30, 40]) {
        expect(concealedHistory([first, second], permutation, removed),
          `hidden [${first}, ${second}], shuffle [${permutation}], remove ${removed}`).toEqual(baseline);
      }
    }
  });

  it.each([0, 1, null])("keeps EFFECT_PUBLIC cards on their sleeve after an initial query by viewer %s", (initialViewer) => {
    const ctx = createEventContext();
    const events = observeMoveEvents({ type: M.DRAW, player: 0, drawn: [10, 20, 30, 40, 50].map((code) => ({ code, position: P.FACEDOWN_ATTACK })) }, cards, ctx, 1);
    let raw = [10, 20, 30, 40, 50];
    const project = (viewer: number | null) => projectView({
      lib: { duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
        duelQueryLocation: (_h: unknown, q: { controller: number; location: number }) => q.controller === 0 && q.location === L.HAND
          ? raw.map((code) => ({ code, position: P.FACEDOWN_ATTACK, isPublic: code === 20 || code === 50 })) : [] } as never,
      handle: {} as never, cards, viewer, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
      prompt: null, promptSeat: null, log: [], events, result: null, reveals: createRevealMap(), mode: "normal", handIdentities: ctx.handIdentities,
    });
    project(initialViewer);
    const before = [0, 1, 2, 3, 4].map((sequence) => ctx.handIdentities.at(0, false, sequence));
    // An owner-only query observes the same public flags, independent of projection order.
    expect(project(0).seats[0]!.hand.map((card) => card.code)).toEqual(raw);
    raw = [50, 30, 20, 10, 40];
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: raw }, cards, ctx, 6);
    for (const viewer of [1, null]) {
      const view = project(viewer);
      expect(view.seats[0]!.hand.map((card) => card.handId)).toEqual([before[4], before[0], before[1], before[2], before[3]]);
      expect(view.seats[0]!.hand.map((card) => card.code)).toEqual([50, undefined, 20, undefined, undefined]);
      expect(view.events[1]!.handId).toBe(view.seats[0]!.hand[2]!.handId);
      expect(view.events[4]!.handId).toBe(view.seats[0]!.hand[0]!.handId);
      expect(project(viewer)).toEqual(view);
    }
  });

  it("forgets a removed public effect before a concealed hand shuffle", () => {
    const ctx = createEventContext();
    observeMoveEvents({ type: M.DRAW, player: 0, drawn: [10, 20].map((code) => ({ code, position: P.FACEDOWN_ATTACK })) }, cards, ctx, 1);
    let isPublic = true;
    let raw = [10, 20];
    const project = (viewer: number | null) => projectView({
      lib: { duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
        duelQueryLocation: (_h: unknown, q: { controller: number; location: number }) => q.controller === 0 && q.location === L.HAND
          ? raw.map((code) => ({ code, position: P.FACEDOWN_ATTACK, isPublic: code === 20 && isPublic })) : [] } as never,
      handle: {} as never, cards, viewer, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
      prompt: null, promptSeat: null, log: [], events: [], result: null, reveals: createRevealMap(), mode: "normal", handIdentities: ctx.handIdentities,
    });
    const before = project(null).seats[0]!.hand.map((card) => card.handId);
    isPublic = false;
    raw = [20, 10];
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: raw }, cards, ctx, 3);
    project(0); // The effect reset and shuffle may occur between consecutive views.
    for (const viewer of [1, null]) {
      const hand = project(viewer).seats[0]!.hand;
      expect(hand.map((card) => card.handId)).toEqual(before);
      expect(hand.map((card) => card.code)).toEqual([undefined, undefined]);
    }
  });

  it("does not let viewer-scoped confirmations reveal a concealed shuffle through sleeves or arrivals", () => {
    const snapshots = [[10, 20, 30], [30, 20, 10]].map((after) => {
      const ctx = createEventContext();
      const reveals = createRevealMap();
      const events = observeMoveEvents({ type: M.DRAW, player: 0, drawn: [10, 20, 30].map((code) => ({ code, position: P.FACEDOWN_ATTACK })) }, cards, ctx, 1);
      let raw = [10, 20, 30];
      const project = (viewer: number | null) => projectView({
        lib: { duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
          duelQueryLocation: (_h: unknown, q: { controller: number; location: number }) => q.controller === 0 && q.location === L.HAND
            ? raw.map((code) => ({ code, position: P.FACEDOWN_ATTACK, isPublic: false })) : [] } as never,
        handle: {} as never, cards, viewer, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
        prompt: null, promptSeat: null, log: [], events, result: null, reveals, mode: "normal", handIdentities: ctx.handIdentities,
      });
      observeMoveEvents({ type: M.CONFIRM_CARDS, player: 1, cards: [{ controller: 0, location: L.HAND, sequence: 0, code: 10 }] }, cards, ctx, 4);
      noteReveal(reveals, 1, 0, L.HAND, 0, 10);
      expect(project(1).seats[0]!.hand[0]!.code).toBe(10);
      expect(project(null).seats[0]!.hand[0]!.code).toBeUndefined();
      // engine.applyMessage clears confirmations before recording SHUFFLE_HAND.
      clearRevealsAt(reveals, 0, L.HAND);
      raw = after;
      observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: raw }, cards, ctx, 4);
      return [project(1), project(null)];
    });
    expect(snapshots[0]).toEqual(snapshots[1]);
  });

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

  it.each(["incomplete", "mismatched", "shuffled", "removed"])("never filters engine cards when identity metadata is %s", (mismatch) => {
    const ctx = createEventContext();
    ctx.handIdentities.add(0, 99, 0, 1);
    if (mismatch !== "incomplete") ctx.handIdentities.add(0, 98, 1, 2);
    if (mismatch === "shuffled") ctx.handIdentities.shuffle(0, [97, 96, 95, 94]);
    if (mismatch === "removed") ctx.handIdentities.remove(0, 0);
    for (const viewer of [0, 1, null]) {
      const view = projectView({
        lib: { duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: [] }),
          duelQueryLocation: (_h: unknown, q: { controller: number; location: number }) => q.controller === 0 && q.location === L.HAND
            ? [30, 10, 20].map((code) => ({ code, position: P.FACEDOWN_ATTACK })) : [] } as never,
        handle: {} as never, cards, viewer, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
        prompt: null, promptSeat: null, log: [], events: [], result: null, reveals: createRevealMap(), mode: "normal", handIdentities: ctx.handIdentities,
      });
      expect(view.seats[0]!.hand.map((c) => [c.code, c.sequence])).toEqual([30, 10, 20].map((code, sequence) => [viewer === 0 ? code : undefined, sequence]));
    }
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
      for (const viewer of [1, null]) {
        const view = project(viewer);
        expect(view.events[2]!.handId).toBe(view.seats[0]!.hand[2]!.handId);
        expect(view.events[2]!.handId).toMatch(/^sleeve-/);
      }
      expect(project(null).seats[0]!.hand.map((c) => c.handId)).not.toEqual(own.seats[0]!.hand.map((c) => c.handId));
      expect(project(0)).toEqual(own); // reads and replay snapshots never mutate order
      if (source === L.GRAVE) {
        const spectator = project(null);
        noteReveal(reveals, 1, 0, L.HAND, 2, 10);
        expect(project(1).events[2]!.handId).toBe("departed-3");
        expect(project(null)).toEqual(spectator); // A private confirmation cannot retire spectator history.
        clearRevealsAt(reveals, 0, L.HAND);
        noteReveal(reveals, 1, 0, L.HAND, 1, 20);
      }
    }
  });
});
