import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/duel-host", () => ({ callDuelHost: vi.fn() }));

import { CARD_TYPE_BITS as T } from "@yugidraft/shared/duels";
import { createEngineTypeLookup, engineCardTypes } from "../src/lib/draft-engine-types";

const actor = { guildId: "g", playerId: 1 };
const monster = T.monster | T.effect;

describe("engineCardTypes", () => {
  it("reads a monster type from the engine's race text", () => {
    expect(engineCardTypes({ type: monster, race: "Dragon" })).toEqual({ race: "Dragon", spellTrapType: null });
    expect(engineCardTypes({ type: monster | T.fusion, race: "Spellcaster" })).toEqual({ race: "Spellcaster", spellTrapType: null });
  });
  it("leaves the monster type empty when the engine has none", () => {
    expect(engineCardTypes({ type: monster, race: "unknown" })).toEqual({ race: null, spellTrapType: null });
    expect(engineCardTypes({ type: monster, race: "" })).toEqual({ race: null, spellTrapType: null });
  });
  it.each([
    [T.spell, "Normal"],
    [T.spell | T.quickPlay, "Quick-Play"],
    [T.spell | T.continuous, "Continuous"],
    [T.spell | T.equip, "Equip"],
    [T.spell | T.field, "Field"],
    [T.spell | T.ritual, "Ritual"],
  ])("maps spell type bits %i to %s", (type, want) => {
    expect(engineCardTypes({ type, race: "unknown" })).toEqual({ race: null, spellTrapType: want });
  });
  it.each([
    [T.trap, "Normal"],
    [T.trap | T.continuous, "Continuous"],
    [T.trap | T.counter, "Counter"],
  ])("maps trap type bits %i to %s", (type, want) => {
    expect(engineCardTypes({ type, race: "unknown" })).toEqual({ race: null, spellTrapType: want });
  });
});

type Call = { op: string; codes: number[] };

function fakeHost(engine: Record<number, { type: number; race: string }>, aliases: Record<number, number | null> = {}) {
  const calls: Call[] = [];
  const call = vi.fn(async (input: Call) => {
    calls.push(input);
    if (input.op === "card-details") {
      const cards = input.codes.filter((c) => engine[c]).map((code) => ({ code, ...engine[code] }));
      return { cards, missing: input.codes.filter((c) => !engine[c]) };
    }
    return { codes: Object.fromEntries(input.codes.map((id) => [String(id), id in aliases ? aliases[id] : null])) };
  });
  return { call, calls };
}

describe("engine type lookup", () => {
  it("asks the host once per batch and serves repeats from the cache", async () => {
    const host = fakeHost({ 1: { type: monster, race: "Dragon" }, 2: { type: T.spell | T.quickPlay, race: "unknown" } });
    const lookup = createEngineTypeLookup({ call: host.call });
    const first = await lookup.lookup([1, 2, 1], actor);
    expect(first.get(1)).toEqual({ race: "Dragon", spellTrapType: null });
    expect(first.get(2)).toEqual({ race: null, spellTrapType: "Quick-Play" });
    expect(host.calls).toEqual([{ op: "card-details", codes: [1, 2] }]);
    await lookup.lookup([2, 1], actor);
    expect(host.call).toHaveBeenCalledTimes(1);
  });

  it("resolves an id the engine does not list through normalize-codes, and remembers ids it cannot resolve", async () => {
    const host = fakeHost({ 100001: { type: monster, race: "Warrior" } }, { 1: 100001, 2: null });
    const lookup = createEngineTypeLookup({ call: host.call });
    const got = await lookup.lookup([1, 2], actor);
    expect(got.get(1)).toEqual({ race: "Warrior", spellTrapType: null });
    expect(got.has(2)).toBe(false);
    expect(host.calls.map((c) => c.op)).toEqual(["card-details", "normalize-codes", "card-details"]);
    await lookup.lookup([1, 2], actor);
    expect(host.call).toHaveBeenCalledTimes(3);
  });

  it("shares one host call between loads of the same pack", async () => {
    const host = fakeHost({ 1: { type: monster, race: "Fiend" } });
    const lookup = createEngineTypeLookup({ call: host.call });
    const [a, b] = await Promise.all([lookup.lookup([1], actor), lookup.lookup([1], actor)]);
    expect(a.get(1)?.race).toBe("Fiend");
    expect(b.get(1)?.race).toBe("Fiend");
    expect(host.call).toHaveBeenCalledTimes(1);
  });

  it("returns no types when the host is down, then leaves it alone until the backoff passes", async () => {
    let t = 1_000;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const call = vi.fn(async () => {
      throw new Error("down");
    });
    const lookup = createEngineTypeLookup({ call, backoffMs: 60_000, now: () => t });
    expect((await lookup.lookup([1], actor)).size).toBe(0);
    expect(call).toHaveBeenCalledTimes(1);
    t += 30_000;
    expect((await lookup.lookup([1], actor)).size).toBe(0);
    expect(call).toHaveBeenCalledTimes(1);
    t += 31_000;
    await lookup.lookup([1], actor);
    expect(call).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("treats a malformed host answer as the host being down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lookup = createEngineTypeLookup({ call: async () => ({ nope: true }) });
    expect((await lookup.lookup([1], actor)).size).toBe(0);
    warn.mockRestore();
  });

  it("goes ahead without types when the host is slow, and keeps the late answer for the next load", async () => {
    vi.useFakeTimers();
    try {
      let release: (v: unknown) => void = () => {};
      const call = vi.fn(
        () => new Promise((resolve) => {
          release = resolve;
        }),
      );
      const lookup = createEngineTypeLookup({ call, timeoutMs: 1500 });
      const pending = lookup.lookup([1], actor);
      await vi.advanceTimersByTimeAsync(1600);
      expect((await pending).size).toBe(0);
      release({ cards: [{ code: 1, type: monster, race: "Pyro" }], missing: [] });
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await lookup.lookup([1], actor)).get(1)?.race).toBe("Pyro");
    } finally {
      vi.useRealTimers();
    }
  });
});
