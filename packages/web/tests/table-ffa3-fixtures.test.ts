import { describe, expect, it } from "vitest";
import { FFA3_FIXTURES, ffa3Variant } from "@/components/duel/table/fixtures/ffa3";

describe("3-way fixtures", () => {
  it("offers the phase moves in the main phase, so the station track has To Battle and End Turn", () => {
    const prompt = FFA3_FIXTURES.states.main.room.engine!.prompt!;
    const ids = prompt.options.map((option) => option.id);
    expect(ids).toContain("to_bp");
    expect(ids).toContain("to_ep");
  });

  it("gives the result state the order in which the rivals left", () => {
    expect(FFA3_FIXTURES.states.result.ui?.initialOutOrder).toEqual([[2], [1]]);
  });

  it("asks for one of 14 Deck cards in the `cards` preview pick, to review a long card strip", () => {
    const set = ffa3Variant(FFA3_FIXTURES, { out: [], pick: "cards" });
    const prompt = set.states.main.room.engine!.prompt!;
    expect(prompt.kind).toBe("cards");
    expect(prompt.options).toHaveLength(14);
    expect(prompt.options.every((option) => option.card)).toBe(true);
    expect(prompt.options.map((option) => option.card!.name)).toContain("Red-Eyes Fang with Chain Dragon");
  });
});
