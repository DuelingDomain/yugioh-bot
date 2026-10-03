import { describe, expect, it } from "vitest";
import { HandIdentities } from "../src/hand-identities.js";
import { createEventContext, observeMoveEvents } from "../src/views.js";
import { OcgLocation as L, OcgMessageType as M, OcgPosition as P } from "ocgcore-wasm";

describe("animation identities in engine slots", () => {
  it.each([-1, 2, NaN, 0.5])("ignores an invalid animation seat %s without throwing", (seat) => {
    const ids = new HandIdentities();
    ids.add(0, 10, 0, 1);
    const original = ids.at(0, true, 0);
    expect(() => {
      ids.add(seat, 20, 0, 2);
      ids.remove(seat, 0);
      ids.relocate(seat, 0, 1);
      ids.shuffle(seat, [20]);
      expect(ids.arrival(seat, true, 2)).toBeUndefined();
    }).not.toThrow();
    expect(ids.at(0, true, 0)).toBe(original);
  });

  it.each([-1, NaN, Infinity, 0.5])("ignores invalid engine sequence %s without corrupting valid identities", (sequence) => {
    const ids = new HandIdentities();
    ids.add(0, 10, 0, 1); ids.add(0, 20, 1, 2);
    const original = [0, 1].map((index) => ids.at(0, true, index));
    expect(() => {
      ids.add(0, 30, sequence, 3);
      ids.remove(0, sequence);
      ids.relocate(0, sequence, 0);
      ids.relocate(0, 0, sequence);
    }).not.toThrow();
    expect([0, 1].map((index) => ids.at(0, true, index))).toEqual(original);
    expect(ids.arrival(0, true, 3)).toBeUndefined();
  });

  it.each([0, L.OVERLAY])("does not bind a skipped move from %s to a later event's arrival id", (source) => {
    const ctx = createEventContext();
    const cards = { get: () => undefined } as never;
    const skipped = observeMoveEvents({ type: M.MOVE, card: 10,
      from: { controller: 0, location: source as L, sequence: 0, position: P.FACEDOWN_ATTACK },
      to: { controller: 0, location: L.HAND, sequence: 0, position: P.FACEDOWN_ATTACK } }, cards, ctx, 5);
    expect(skipped).toEqual([]);
    expect(ctx.handSize[0]).toBe(1);
    expect(ctx.handIdentities.at(0, true, 0)).toBeDefined();
    for (const owner of [true, false]) expect(ctx.handIdentities.arrival(0, owner, 5)).toBeUndefined();
    const emitted = observeMoveEvents({ type: M.MOVE, card: 20,
      from: { controller: 0, location: L.GRAVE, sequence: 0, position: P.FACEUP_ATTACK },
      to: { controller: 0, location: L.HAND, sequence: 1, position: P.FACEDOWN_ATTACK } }, cards, ctx, 5);
    expect(emitted.map((event) => event.id)).toEqual([5]);
    for (const owner of [true, false]) expect(ctx.handIdentities.arrival(0, owner, 5)?.sequence).toBe(1);
  });

  it("keeps observing real moves after mismatched animation messages", () => {
    const ctx = createEventContext();
    const cards = { get: () => undefined } as never;
    expect(() => {
      observeMoveEvents({ type: M.SHUFFLE_HAND, player: 2, cards: [10] } as never, cards, ctx, 1);
      observeMoveEvents({ type: M.MOVE, card: 10,
        from: { controller: 2, location: L.HAND, sequence: 0, position: P.FACEDOWN_ATTACK },
        to: { controller: 0, location: L.GRAVE, sequence: 0, position: P.FACEUP_ATTACK } } as never, cards, ctx, 1);
    }).not.toThrow();
    const events = observeMoveEvents({ type: M.DRAW, player: 0, drawn: [{ code: 20, position: P.FACEDOWN_ATTACK }] }, cards, ctx, 2);
    expect(events[0]?.zone?.sequence).toBe(0);
    expect(ctx.handIdentities.arrival(0, true, 2)?.sequence).toBe(0);
  });

  it("inserts in the engine's middle slot and compacts a departure", () => {
    const ids = new HandIdentities();
    ids.add(0, 10, 0, 1); ids.add(0, 20, 1, 2);
    const first = ids.at(0, true, 0);
    const second = ids.at(0, true, 1);
    ids.add(0, 30, 1, 3);
    expect(ids.arrival(0, true, 3)?.sequence).toBe(1);
    expect(ids.at(0, true, 0)).toBe(first);
    expect(ids.at(0, true, 2)).toBe(second);
    ids.remove(0, 0);
    expect(ids.arrival(0, true, 3)?.sequence).toBe(0);
    expect(ids.at(0, true, 1)).toBe(second);
    expect(ids.arrival(0, true, 1)).toBeUndefined();
  });

  it("follows the core's re-sequencing, including duplicate copies and multiple arrivals", () => {
    const ids = new HandIdentities();
    ids.add(0, 10, 0, 1); ids.add(0, 10, 1, 2); ids.add(0, 20, 2, 3);
    const before = [0, 1, 2].map((sequence) => ids.at(0, true, sequence));
    ids.shuffle(0, [20, 10, 10]);
    ids.add(0, 30, 3, 4);
    ids.shuffle(0, [30, 10, 20, 10]);
    expect([1, 3, 2].map((sequence) => ids.at(0, true, sequence))).toEqual(before);
    expect([1, 2, 3, 4].map((event) => ids.arrival(0, true, event)?.sequence)).toEqual([1, 3, 2, 0]);
  });

  it("never exposes a hidden permutation through sleeve IDs or arrival slots", () => {
    const a = new HandIdentities();
    const b = new HandIdentities();
    for (const ids of [a, b]) { ids.add(1, 10, 0, 1); ids.add(1, 20, 1, 2); }
    a.shuffle(1, [10, 20]); b.shuffle(1, [20, 10]);
    expect([0, 1].map((s) => a.at(1, false, s))).toEqual([0, 1].map((s) => b.at(1, false, s)));
    expect(a.arrival(1, false, 1)).toEqual(b.arrival(1, false, 1));
    expect(a.at(1, false, 0)).not.toBe(a.at(1, true, 0));
    for (const ids of [a, b]) { ids.remove(1, 0); ids.add(1, 30, 0, 3); }
    expect(a.arrival(1, false, 3)).toEqual(b.arrival(1, false, 3));
    expect(a.arrival(1, false, 3)?.sequence).toBe(0);
  });

  it("moves public sleeves with their cards while hidden sleeves keep their old order", () => {
    const ctx = createEventContext();
    const cards = { get: () => undefined } as never;
    observeMoveEvents({ type: M.DRAW, player: 0, drawn: [10, 20, 30, 40].map((code) => ({
      code, position: code === 20 ? P.FACEUP_ATTACK : P.FACEDOWN_ATTACK,
    })) }, cards, ctx, 1);
    const before = [0, 1, 2, 3].map((sequence) => ctx.handIdentities.at(0, false, sequence));
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: [40, 30, 10, 20] }, cards, ctx, 5);
    expect([0, 1, 2, 3].map((sequence) => ctx.handIdentities.at(0, false, sequence))).toEqual([
      before[0], before[2], before[3], before[1],
    ]);
    expect(ctx.handIdentities.arrival(0, false, 2)).toEqual({ id: before[1], sequence: 3 });
  });

  it("tracks public hand arrivals from MOVE messages", () => {
    const ctx = createEventContext();
    const cards = { get: () => undefined } as never;
    observeMoveEvents({ type: M.DRAW, player: 0, drawn: [{ code: 10, position: P.FACEDOWN_ATTACK }] }, cards, ctx, 1);
    observeMoveEvents({ type: M.MOVE, card: 20,
      from: { controller: 0, location: L.GRAVE, sequence: 0, position: P.FACEUP_ATTACK },
      to: { controller: 0, location: L.HAND, sequence: 1, position: P.FACEUP_ATTACK } }, cards, ctx, 2);
    const before = ctx.handIdentities.at(0, false, 1);
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: [20, 10] }, cards, ctx, 3);
    expect(ctx.handIdentities.at(0, false, 0)).toBe(before);
    expect(ctx.handIdentities.arrival(0, false, 2)?.sequence).toBe(0);
  });

  it("updates public sleeve tracking when hand positions change", () => {
    const ctx = createEventContext();
    const cards = { get: () => undefined } as never;
    observeMoveEvents({ type: M.DRAW, player: 0, drawn: [10, 20].map((code) => ({ code, position: P.FACEDOWN_ATTACK })) }, cards, ctx, 1);
    const before = [0, 1].map((sequence) => ctx.handIdentities.at(0, false, sequence));
    observeMoveEvents({ type: M.POS_CHANGE, code: 20, controller: 0, location: L.HAND, sequence: 1,
      prev_position: P.FACEDOWN_ATTACK, position: P.FACEUP_ATTACK }, cards, ctx, 3);
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: [20, 10] }, cards, ctx, 3);
    expect([0, 1].map((sequence) => ctx.handIdentities.at(0, false, sequence))).toEqual([before[1], before[0]]);
    observeMoveEvents({ type: M.POS_CHANGE, code: 20, controller: 0, location: L.HAND, sequence: 0,
      prev_position: P.FACEUP_ATTACK, position: P.FACEDOWN_ATTACK }, cards, ctx, 3);
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: [10, 20] }, cards, ctx, 3);
    expect([0, 1].map((sequence) => ctx.handIdentities.at(0, false, sequence))).toEqual([before[1], before[0]]);
  });

  it("repairs missing and stale sleeves to the shuffle's hand size before the next draw", () => {
    const ctx = createEventContext();
    const cards = { get: () => undefined } as never;
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: [10, 20, 30] }, cards, ctx, 1);
    const before = [0, 1, 2].map((sequence) => ctx.handIdentities.at(0, false, sequence));
    expect(before.every((id) => id != null)).toBe(true);
    expect(new Set(before).size).toBe(3);
    expect(ctx.handIdentities.at(0, false, 3)).toBeUndefined();
    expect(ctx.handSize[0]).toBe(3);
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: [20] }, cards, ctx, 1);
    expect(ctx.handIdentities.at(0, false, 0)).toBe(before[0]);
    expect(ctx.handIdentities.at(0, false, 1)).toBeUndefined();
    expect(ctx.handSize[0]).toBe(1);
    const [draw] = observeMoveEvents({ type: M.DRAW, player: 0, drawn: [{ code: 40, position: P.FACEDOWN_ATTACK }] }, cards, ctx, 1);
    expect(draw?.zone?.sequence).toBe(1);
    expect(ctx.handIdentities.arrival(0, false, 1)?.sequence).toBe(1);
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: [] }, cards, ctx, 2);
    expect(ctx.handIdentities.at(0, false, 0)).toBeUndefined();
    expect(ctx.handSize[0]).toBe(0);
  });

  it("does not expose owner reconciliation misses through later sleeve IDs", () => {
    const a = new HandIdentities();
    const b = new HandIdentities();
    for (const ids of [a, b]) { ids.add(0, 10, 0, 1); ids.add(0, 20, 1, 2); }
    a.shuffle(0, [20, 10]); b.shuffle(0, [30, 40]);
    for (const ids of [a, b]) ids.add(0, 50, 2, 3);
    expect([0, 1, 2].map((sequence) => a.at(0, false, sequence))).toEqual([0, 1, 2].map((sequence) => b.at(0, false, sequence)));
    expect(a.arrival(0, false, 3)).toEqual(b.arrival(0, false, 3));
  });

  it("forgets hidden arrival targets after a shuffle while retaining public and owner targets", () => {
    const ctx = createEventContext();
    const cards = { get: () => undefined } as never;
    observeMoveEvents({ type: M.DRAW, player: 0, drawn: [10, 20].map((code) => ({
      code, position: code === 20 ? P.FACEUP_ATTACK : P.FACEDOWN_ATTACK,
    })) }, cards, ctx, 1);
    observeMoveEvents({ type: M.SHUFFLE_HAND, player: 0, cards: [20, 10] }, cards, ctx, 3);
    expect(ctx.handIdentities.arrival(0, false, 1)).toBeUndefined();
    expect(ctx.handIdentities.arrival(0, false, 2)?.sequence).toBe(0);
    expect(ctx.handIdentities.arrival(0, true, 1)?.sequence).toBe(1);
    expect(ctx.handIdentities.arrival(0, true, 2)?.sequence).toBe(0);
  });

  it("keeps repaired sleeve IDs stable when the next query validates their visibility", () => {
    const ids = new HandIdentities();
    ids.shuffle(0, [10, 20]);
    const before = [0, 1].map((sequence) => ids.at(0, false, sequence));
    ids.syncPublic(0, [{ code: 10, isPublic: false }, { code: 20, isPublic: false }]);
    expect([0, 1].map((sequence) => ids.at(0, false, sequence))).toEqual(before);
    ids.add(0, 30, 2, 1);
    expect(ids.at(0, false, 2)).toBe("sleeve-3");
  });

  it("preserves a later hidden arrival when validating an earlier shuffle", () => {
    const ids = new HandIdentities();
    ids.add(0, 10, 0, 1); ids.add(0, 20, 1, 2, true);
    ids.shuffle(0, [20, 10]);
    ids.add(0, 30, 2, 3);
    ids.syncPublic(0, [{ code: 20, isPublic: true }, { code: 10, isPublic: false }, { code: 30, isPublic: false }]);
    expect(ids.arrival(0, false, 3)?.sequence).toBe(2);
    expect(ids.arrival(0, false, 2)?.sequence).toBe(0);
    expect(ids.arrival(0, false, 1)).toBeUndefined();
  });

  it("retains all sleeves when one public duplicate becomes hidden during a shuffle", () => {
    const ids = new HandIdentities();
    ids.add(0, 10, 0, 1, true); ids.add(0, 10, 1, 2, true); ids.add(0, 20, 2, 3);
    const before = [0, 1, 2].map((sequence) => ids.at(0, false, sequence));
    ids.shuffle(0, [10, 20, 10]);
    ids.syncPublic(0, [{ code: 10, isPublic: false }, { code: 20, isPublic: false }, { code: 10, isPublic: true }]);
    expect([0, 1, 2].map((sequence) => ids.at(0, false, sequence))).toEqual([before[1], before[2], before[0]]);
    expect(ids.arrival(0, false, 2)).toBeUndefined();
    expect(ids.arrival(0, false, 1)?.sequence).toBe(2);
  });

  it("restores hidden order when a public effect expires across multiple unobserved shuffles", () => {
    const ids = new HandIdentities();
    [10, 20, 30, 40].forEach((code, sequence) => ids.add(0, code, sequence, sequence + 1, code === 20));
    const before = [0, 1, 2, 3].map((sequence) => ids.at(0, false, sequence));
    ids.shuffle(0, [40, 20, 30, 10]);
    ids.shuffle(0, [20, 40, 10, 30]);
    ids.syncPublic(0, [20, 40, 10, 30].map((code) => ({ code, isPublic: false })));
    expect([0, 1, 2, 3].map((sequence) => ids.at(0, false, sequence))).toEqual(before);
    expect(ids.arrival(0, false, 2)).toBeUndefined();
  });

  it("keeps pending visibility validation aligned through removals, insertions and public relocations", () => {
    const ids = new HandIdentities();
    ids.add(0, 10, 0, 1); ids.add(0, 20, 1, 2, true); ids.add(0, 30, 2, 3);
    const publicSleeve = ids.at(0, false, 1);
    ids.shuffle(0, [20, 30, 10]);
    ids.remove(0, 1);
    ids.add(0, 40, 1, 4);
    const laterSleeve = ids.at(0, false, 1);
    const hiddenSleeve = ids.at(0, false, 2);
    ids.relocate(0, 0, 2);
    ids.syncPublic(0, [40, 10, 20].map((code) => ({ code, isPublic: code === 20 })));
    expect([0, 1, 2].map((sequence) => ids.at(0, false, sequence))).toEqual([laterSleeve, hiddenSleeve, publicSleeve]);
    expect(ids.at(0, false, 3)).toBeUndefined();
    expect(ids.arrival(0, false, 2)?.sequence).toBe(2);
    expect(ids.arrival(0, false, 4)?.sequence).toBe(0);
  });

  it.each(["remove", "insert", "relocate"] as const)("does not expose an expired public card's hidden permutation after an intervening %s", (mutation) => {
    const snapshots = [[20, 40, 10, 30], [10, 40, 20, 30]].map((shuffled) => {
      const ids = new HandIdentities();
      [10, 20, 30, 40].forEach((code, sequence) => ids.add(0, code, sequence, sequence + 1, code === 20 || code === 40));
      const publicSleeve = ids.at(0, false, 3);
      ids.shuffle(0, shuffled);
      const final = [...shuffled];
      if (mutation === "remove") { ids.remove(0, 0); final.splice(0, 1); }
      if (mutation === "insert") { ids.add(0, 50, 0, 5); final.splice(0, 0, 50); }
      if (mutation === "relocate") { ids.relocate(0, 0, 2); final.splice(2, 0, final.splice(0, 1)[0]!); }
      ids.syncPublic(0, final.map((code) => ({ code, isPublic: code === 40 })));
      const publicSlot = final.indexOf(40);
      expect(ids.at(0, false, publicSlot)).toBe(publicSleeve);
      expect(ids.arrival(0, false, 4)).toEqual({ id: publicSleeve, sequence: publicSlot });
      expect(ids.arrival(0, false, 2)).toBeUndefined();
      return final.map((_, sequence) => ids.at(0, false, sequence));
    });
    expect(snapshots[0]).toEqual(snapshots[1]);
  });

  it("follows public hand-to-hand sequence moves for both views", () => {
    const ids = new HandIdentities();
    ids.add(0, 10, 0, 1); ids.add(0, 20, 1, 2);
    ids.relocate(0, 0, 1);
    for (const owner of [true, false]) expect(ids.arrival(0, owner, 1)?.sequence).toBe(1);
  });

  it("accounts for REMOVE_CARDS before assigning a later draw's engine slot", () => {
    const ctx = createEventContext();
    for (let i = 0; i < 4; i++) ctx.handIdentities.add(0, 10 + i, i, i + 1);
    ctx.handSize[0] = 4;
    observeMoveEvents({ type: M.REMOVE_CARDS, cards: [1, 2].map((sequence) => ({ controller: 0, location: L.HAND, sequence, position: P.FACEDOWN_ATTACK })) }, {} as never, ctx, 5);
    expect(ctx.handIdentities.arrival(0, true, 4)?.sequence).toBe(1);
    const draws = observeMoveEvents({ type: M.DRAW, player: 0, drawn: [{ code: 20, position: P.FACEDOWN_ATTACK }] }, { get: () => undefined } as never, ctx, 5);
    expect(draws[0]?.zone?.sequence).toBe(2);
    expect(ctx.handSize[0]).toBe(3);
  });
});
