import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelFormat, DuelSeatView, SandboxRun } from "@yugidraft/shared/duels";
import { mergeRevealedHands, policiesForRun, resolveActingSeat } from "../src/sandbox-seats.js";

const access = {
  sandbox: true, actor: 42, organizerPlayerId: 42, mySeat: 0,
  format: "ffa4" as const, manualSeats: new Set([2]),
};

describe("resolveActingSeat", () => {
  it("defaults to the actor's database seat", () => {
    expect(resolveActingSeat(access)).toBe(0);
  });

  it.each([0, 2])("allows controlled seat %s", (as) => {
    expect(resolveActingSeat({ ...access, as })).toBe(as);
  });

  it.each([1, 3])("requires control of auto seat %s", (as) => {
    expect(() => resolveActingSeat({ ...access, as })).toThrowError(
      expect.objectContaining({ status: 409, message: `Take control of seat ${as} first` }),
    );
  });

  it.each([null, "2", true, 1.5, -1, 4, NaN, Infinity, {}, []])("rejects invalid seat %j", (as) => {
    expect(() => resolveActingSeat({ ...access, as })).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it.each(["1v1", "ffa3"] as const)("rejects a stale manual seat outside %s", (format) => {
    expect(() => resolveActingSeat({ ...access, format, as: 3, manualSeats: new Set([3]) }))
      .toThrowError(expect.objectContaining({ status: 400 }));
  });

  it.each([0, 1, 2, 3])("allows each Tag seat after taking control: %s", (as) => {
    expect(resolveActingSeat({ ...access, format: "tag", manualSeats: new Set([1, 2, 3]), as })).toBe(as);
  });

  it.each([undefined, 0, 2])("rejects another actor, including a spectator (as=%s)", (as) => {
    expect(() => resolveActingSeat({ ...access, actor: 7, mySeat: null, as }))
      .toThrowError(expect.objectContaining({ status: 403 }));
  });

  it("leaves ordinary duel seat selection unchanged", () => {
    expect(resolveActingSeat({ ...access, sandbox: false, actor: 7, mySeat: 1 })).toBe(1);
    expect(resolveActingSeat({ ...access, sandbox: false, actor: 7, mySeat: null })).toBeNull();
  });

  it("rejects an acting-seat override on an ordinary duel", () => {
    expect(() => resolveActingSeat({ ...access, sandbox: false, as: 0 }))
      .toThrowError(expect.objectContaining({ status: 409 }));
  });

  it("does not change the controlled seats", () => {
    resolveActingSeat({ ...access, as: 2 });
    expect([...access.manualSeats]).toEqual([2]);
  });
});

function seatView(seat: number, visible = false): DuelSeatView {
  const card = (location: number) => ({
    controller: seat, location, sequence: 0, position: 8,
    ...(visible ? { code: 1000 + seat, name: `Card ${seat}` } : {}),
  });
  return {
    seat, lp: 8000, hand: [card(2)], extra: [card(64)], deckCount: 20, extraCount: 1,
    monsters: [card(4)], spells: [card(8)], graveyard: [], banished: [card(32)],
  };
}

function view(viewer: number, format: DuelFormat = "ffa4"): DuelEngineView {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  return {
    revision: 5, format, turn: 1, turnSeat: 0, phase: "draw", prioritySeat: 2,
    seats: Array.from({ length: count }, (_, seat) => seatView(seat, seat === viewer)),
    prompt: viewer === 2 ? {
      id: "private", seat: 2, kind: "choice", title: "Private prompt",
      options: [{ id: "yes", label: "Private answer" }],
    } : null,
    chain: [], events: [], log: [{ id: 1, text: `Private log ${viewer}` }], result: null,
    chainMode: viewer === 2 ? "always" : "auto",
  };
}

describe("mergeRevealedHands", () => {
  it.each(["1v1", "ffa3", "ffa4", "tag"] as const)("reveals each seat's own hand and Extra Deck in %s", (format) => {
    const base = view(0, format);
    const sources = new Map(base.seats.slice(1).map(({ seat }) => [seat, view(seat, format)]));
    const merged = mergeRevealedHands(base, sources);
    expect(merged).toEqual({
      ...base,
      seats: base.seats.map((seat) => ({ ...seat, hand: seatView(seat.seat, true).hand, extra: seatView(seat.seat, true).extra })),
    });
    expect(merged.prompt).toBeNull();
    expect(JSON.stringify(merged)).not.toContain("Private answer");
  });

  it("keeps the acting seat's prompt and other private fields", () => {
    const base = view(2);
    const merged = mergeRevealedHands(base, new Map([[0, view(0)], [1, view(1)], [3, view(3)]]));
    expect(merged.prompt).toEqual(base.prompt);
    expect(merged.chainMode).toBe("always");
    expect(merged.log).toEqual(base.log);
    expect(merged.prioritySeat).toBe(2);
  });

  it("matches source rows by seat, not their array index", () => {
    const own = view(2);
    own.seats.reverse();
    const merged = mergeRevealedHands(view(0), new Map([[2, own]]));
    expect(merged.seats[2]!.hand[0]!.code).toBe(1002);
    expect(merged.seats[1]!.hand[0]!.code).toBeUndefined();
  });

  it("ignores absent source rows and seats outside the base view", () => {
    const base = view(0, "1v1");
    const incomplete = { ...view(1), seats: [seatView(0, true)] };
    expect(mergeRevealedHands(base, new Map([[1, incomplete], [3, view(3)]]))).toEqual(base);
    expect(mergeRevealedHands(base, new Map())).toEqual(base);
  });

  it("does not change either input view", () => {
    const base = view(0);
    const own = view(1);
    const before = structuredClone({ base, own });
    mergeRevealedHands(base, new Map([[1, own]]));
    expect({ base, own }).toEqual(before);
  });
});

describe("policiesForRun", () => {
  const run: SandboxRun = { bots: { "1": "pass", "2": "practice", "3": "manual" } };

  it("maps pass to empty rules, practice to no rules, and manual to manualSeats", () => {
    const result = policiesForRun(run, "ffa4");
    expect([...result.policies]).toEqual([[1, []]]);
    expect([...result.manualSeats]).toEqual([0, 3]);
  });

  it.each([
    ["1v1", [1]], ["ffa3", [1, 2]], ["ffa4", [1, 2, 3]], ["tag", [1, 2, 3]],
  ] as const)("includes only active seats for %s", (format, seats) => {
    const pass: SandboxRun = { bots: { "1": "pass", "2": "pass", "3": "pass" } };
    expect([...policiesForRun(pass, format).policies.keys()]).toEqual(seats);
    const manual: SandboxRun = { bots: { "1": "manual", "2": "manual", "3": "manual" } };
    expect([...policiesForRun(manual, format).manualSeats]).toEqual([0, ...seats]);
  });

  it("returns fresh state for recovery or a control change", () => {
    const before = structuredClone(run);
    const first = policiesForRun(run, "ffa4");
    first.policies.get(1)!.push({ note: "test", when: () => true, do: () => ({ choice: "yes" }) });
    first.manualSeats.add(2);
    const second = policiesForRun(run, "ffa4");
    expect([...second.policies]).toEqual([[1, []]]);
    expect([...second.manualSeats]).toEqual([0, 3]);
    expect(run).toEqual(before);
  });
});
