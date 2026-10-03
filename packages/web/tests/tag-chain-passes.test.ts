import { describe, expect, it } from "vitest";
import {
  advancePasses,
  chainDecidingSeat,
  chainKeyOf,
  EMPTY_PASSES,
  passedSeatsFor,
  type ChainPassState,
} from "@/components/duel/tag/use-chain-passes";
import type { DuelChainLink, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";

const link = (index: number, seat: number) => ({ index, seat }) as DuelChainLink;
/** A minimal 2v2 view: seats 0 and 2 are team 0, seats 1 and 3 are team 1. */
const view = (chain: DuelChainLink[], over: Partial<DuelEngineView> = {}) =>
  ({ turnSeat: 0, chain, prioritySeat: null, prompt: null, ...over }) as unknown as DuelEngineView;
const prompt = (seat: number, type: string) => ({ seat, context: { type } }) as unknown as DuelPrompt;

describe("chainKeyOf", () => {
  it("is null for an empty chain and changes when a link is added", () => {
    expect(chainKeyOf([])).toBeNull();
    expect(chainKeyOf([link(1, 0)])).not.toEqual(chainKeyOf([link(1, 0), link(2, 1)]));
  });
});

describe("chainDecidingSeat", () => {
  const chain = [link(1, 0)];
  it("is null without a chain", () => {
    expect(chainDecidingSeat(view([], { prioritySeat: 1 }), null)).toBeNull();
  });
  it("reads the public priority seat for a viewer who holds no prompt (partner, rival, spectator)", () => {
    expect(chainDecidingSeat(view(chain, { prioritySeat: 1 }), null)).toBe(1);
  });
  it("reads the viewer's own chain prompt", () => {
    expect(chainDecidingSeat(view(chain, { prioritySeat: 1 }), prompt(1, "chain"))).toBe(1);
    expect(chainDecidingSeat(view(chain), prompt(1, "chain"))).toBe(1);
  });
  it("ignores a prompt that is not a chain prompt", () => {
    expect(chainDecidingSeat(view(chain, { prioritySeat: 1 }), prompt(1, "card"))).toBeNull();
  });
  it("is null while the engine is processing and no prompt is open", () => {
    expect(chainDecidingSeat(view(chain, { prioritySeat: null }), null)).toBeNull();
  });
});

describe("advancePasses", () => {
  const chain = [link(1, 0)];
  const engine = view(chain);
  const key = chainKeyOf(chain);
  const first = advancePasses(EMPTY_PASSES, { engine, decidingSeat: 1 });

  it("starts empty and remembers who decides", () => {
    expect(first.seats).toEqual([]);
    expect(first.lastSeat).toBe(1);
    expect(first.key).toBe(key);
  });
  it("counts the seat that decided as passed when the next expected responder decides", () => {
    const second = advancePasses(first, { engine, decidingSeat: 3 });
    expect(second.seats).toEqual([1]);
    expect(second.lastSeat).toBe(3);
  });
  it("returns the same object for the same input", () => {
    expect(advancePasses(first, { engine, decidingSeat: 1 })).toBe(first);
  });
  it("forgets the passes when the chain grows or ends", () => {
    const second = advancePasses(first, { engine, decidingSeat: 3 });
    expect(advancePasses(second, { engine: view([link(1, 0), link(2, 1)]), decidingSeat: 0 }).seats).toEqual([]);
    expect(advancePasses(second, { engine: view([]), decidingSeat: null })).toBe(EMPTY_PASSES);
  });
  it("keeps the last seat while nobody decides", () => {
    const gap = advancePasses(first, { engine, decidingSeat: null });
    expect(gap).toBe(first);
    expect(advancePasses(gap, { engine, decidingSeat: 3 }).seats).toEqual([1]);
  });
  it("ignores a seat that is not the next expected responder (a link resolving)", () => {
    // Seat 1 decided. Seat 2 (the owner's partner) cannot be next: seat 3 has not passed.
    expect(advancePasses(first, { engine, decidingSeat: 2 })).toBe(first);
  });
  it("follows the whole round, seen only through the public priority seat", () => {
    let state: ChainPassState = EMPTY_PASSES;
    for (const seat of [1, 3, 0, 2]) state = advancePasses(state, { engine, decidingSeat: seat });
    expect(state.seats).toEqual([1, 3, 0]);
    expect(state.lastSeat).toBe(2);
  });
  it("keeps tracking after a join mid round (the first seen seat stands for the earlier ones)", () => {
    // The viewer sees the round first at seat 3: seat 1 passed before. Then seat 0 decides.
    const joined = advancePasses(EMPTY_PASSES, { engine, decidingSeat: 3 });
    const next = advancePasses(joined, { engine, decidingSeat: 0 });
    expect(next.lastSeat).toBe(0);
    expect(next.seats).toContain(3);
  });
});

describe("passedSeatsFor", () => {
  const chain = [link(1, 0)];
  it("adds the rival team and the earlier members when the deciding seat is on the team of the link owner", () => {
    // Link owner seat 0 (team 0); seat 2 (team 0) decides: team 1 passed and seat 0 passed before it.
    expect(passedSeatsFor(EMPTY_PASSES, chain, 2, 0).sort()).toEqual([0, 1, 3]);
  });
  it("adds the earlier member of a rival team", () => {
    // Seat 3 decides after seat 1 (turn order from seat 0).
    expect(passedSeatsFor(EMPTY_PASSES, chain, 3, 0)).toEqual([1]);
  });
  it("reads the turn order from the turn seat", () => {
    // Turn seat 3: team 1 reads [3, 1]. Seat 1 decides, so seat 3 passed.
    expect(passedSeatsFor(EMPTY_PASSES, chain, 1, 3)).toEqual([3]);
  });
  it("adds only the tracked passes when the deciding seat is the first of the other team", () => {
    expect(passedSeatsFor({ key: "a", seats: [1], lastSeat: 3 }, chain, 1, 0)).toEqual([1]);
  });
  it("is empty without a chain", () => {
    expect(passedSeatsFor(EMPTY_PASSES, [], null, 0)).toEqual([]);
  });
});

describe("viewpoints", () => {
  // Every viewer sees the same engine view except the prompt: only the holder has it.
  const chain = [link(1, 0)];
  const seatsView = (priority: number) => view(chain, { prioritySeat: priority });
  const run = (viewerPrompt: (seat: number) => DuelPrompt | null, order: number[]) => {
    let state: ChainPassState = EMPTY_PASSES;
    for (const seat of order) {
      const engine = seatsView(seat);
      state = advancePasses(state, { engine, decidingSeat: chainDecidingSeat(engine, viewerPrompt(seat)) });
    }
    return state.seats;
  };
  it("a partner, a rival and a spectator all record the same passes", () => {
    const holder = (viewer: number) => (seat: number) => (seat === viewer ? prompt(seat, "chain") : null);
    const partner = run(holder(2), [1, 3, 0]);
    const rival = run(holder(1), [1, 3, 0]);
    const spectator = run(() => null, [1, 3, 0]);
    expect(partner).toEqual([1, 3]);
    expect(rival).toEqual([1, 3]);
    expect(spectator).toEqual([1, 3]);
  });
  it("keeps the viewer's own pass after its prompt becomes null", () => {
    const own = (seat: number) => (seat === 1 ? prompt(1, "chain") : null);
    expect(run(own, [1, 3])).toEqual([1]);
  });
});
