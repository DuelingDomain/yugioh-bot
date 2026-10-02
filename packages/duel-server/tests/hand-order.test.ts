import { describe, expect, it } from "vitest";
import { HandOrder } from "../src/hand-order.js";
import { createEventContext, observeMoveEvents } from "../src/views.js";
import { OcgLocation as L, OcgMessageType as M, OcgPosition as P } from "ocgcore-wasm";

describe("hand presentation order", () => {
  it("compacts hand sequences after the core removes several cards without MOVE messages", () => {
    const ctx = createEventContext();
    for (let i = 0; i < 4; i++) ctx.handOrder.add(0, 10 + i, i);
    ctx.handSize[0] = 4;
    observeMoveEvents({ type: M.REMOVE_CARDS, cards: [1, 2].map((sequence) => ({ controller: 0, location: L.HAND, sequence, position: P.FACEDOWN_ATTACK })) }, {} as never, ctx, 1);
    expect(ctx.handOrder.entries(0, true).map((c) => [c.code, c.sequence])).toEqual([[10, 0], [13, 1]]);
    expect(ctx.handSize[0]).toBe(2);
  });
  it("appends arrivals and closes gaps without changing the engine sequence", () => {
    const order = new HandOrder();
    order.add(0, 10, 0, 1);
    order.add(0, 20, 1, 2);
    order.shuffle(0, [20, 10]);
    order.add(0, 30, 0, 3);
    expect(order.entries(0, true).map((c) => [c.code, c.sequence])).toEqual([[10, 2], [20, 1], [30, 0]]);
    order.remove(0, 1);
    expect(order.entries(0, true).map((c) => [c.code, c.sequence])).toEqual([[10, 1], [30, 0]]);
  });

  it("preserves multiple arrivals in one chain through repeated shuffles and duplicate codes", () => {
    const order = new HandOrder();
    order.add(0, 10, 0, 1);
    order.add(0, 10, 1, 2);
    order.add(0, 20, 2, 3);
    const ids = order.entries(0, true).map((c) => c.id);
    order.shuffle(0, [20, 10, 10]);
    order.add(0, 30, 3, 4);
    order.shuffle(0, [30, 10, 20, 10]);
    expect(order.entries(0, true).map((c) => c.id).slice(0, 3)).toEqual(ids);
    expect(order.entries(0, true).map((c) => c.arrival)).toEqual([1, 2, 3, 4]);
    expect(order.entries(0, true).map((c) => c.sequence)).toEqual([1, 3, 2, 0]);
  });

  it("does not reveal a hidden permutation through sleeve ids or arrival destinations", () => {
    const a = new HandOrder();
    const b = new HandOrder();
    for (const order of [a, b]) { order.add(1, 10, 0, 1); order.add(1, 20, 1, 2); }
    a.shuffle(1, [10, 20]);
    b.shuffle(1, [20, 10]);
    expect(a.entries(1, false)).toEqual(b.entries(1, false));
    expect(a.entries(1, false).map((c) => c.id)).not.toEqual(a.entries(1, true).map((c) => c.id));
    expect(a.entries(1, false).every((c) => c.code === 0)).toBe(true);
    for (const order of [a, b]) { order.remove(1, 0); order.add(1, 30, 1, 3); }
    expect(a.entries(1, false)).toEqual(b.entries(1, false));
    expect(a.entries(1, false).at(-1)?.arrival).toBe(3);
  });

  it("keeps presentation identity during an in-hand sequence move", () => {
    const order = new HandOrder();
    order.add(0, 10, 0); order.add(0, 20, 1);
    const ids = order.entries(0, true).map((c) => c.id);
    order.relocate(0, 0, 1);
    expect(order.entries(0, true).map((c) => c.id)).toEqual(ids);
    expect(order.entries(0, true).map((c) => c.sequence)).toEqual([1, 0]);
  });
});
