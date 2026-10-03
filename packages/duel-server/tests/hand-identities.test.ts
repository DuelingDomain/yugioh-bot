import { describe, expect, it } from "vitest";
import { HandIdentities } from "../src/hand-identities.js";
import { createEventContext, observeMoveEvents } from "../src/views.js";
import { OcgLocation as L, OcgMessageType as M, OcgPosition as P } from "ocgcore-wasm";

describe("animation identities in engine slots", () => {
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
