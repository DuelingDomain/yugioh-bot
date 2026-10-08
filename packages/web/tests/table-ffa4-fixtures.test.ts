import { describe, expect, it } from "vitest";
import { FFA4_FIXTURES, ffa4Variant } from "@/components/duel/table/fixtures/ffa4";

const ids = ["main", "battle-aim", "chain-2", "target-pick", "choose-opponent", "direct-attack", "elimination", "spectator", "result"] as const;

describe("4-way fixtures", () => {
  it("has the nine states, each with four seats", () => {
    for (const id of ids) {
      const state = FFA4_FIXTURES.states[id];
      expect(state.id).toBe(id);
      expect(state.room.engine!.seats).toHaveLength(4);
    }
  });

  it("offers the phase moves in the main phase", () => {
    const options = FFA4_FIXTURES.states.main.room.engine!.prompt!.options.map((option) => option.id);
    expect(options).toContain("to_bp");
    expect(options).toContain("to_ep");
  });

  it("aims Dark Magician at Gaia in the battle state", () => {
    const aim = FFA4_FIXTURES.states["battle-aim"].ui?.aim;
    expect(aim?.from).toBe("0:4:0");
    expect(aim?.to.zones).toEqual(["2:4:2"]);
  });

  it("makes a two-link chain with Sakuretsu Armor then Mystical Space Typhoon", () => {
    const chain = FFA4_FIXTURES.states["chain-2"].room.engine!.chain!;
    expect(chain.map((entry) => entry.seat)).toEqual([2, 3]);
  });

  it("offers the three rivals as opponents", () => {
    const options = FFA4_FIXTURES.states["choose-opponent"].room.engine!.prompt!.options;
    expect(options.map((option) => option.controller)).toEqual([1, 2, 3]);
  });

  it("clears Juniper in the elimination state and gives the exit order in the result", () => {
    const juniper = FFA4_FIXTURES.states.elimination.room.engine!.seats[2];
    expect(juniper.lp).toBe(0);
    expect(juniper.eliminated).toBe(true);
    expect(FFA4_FIXTURES.states.result.ui?.initialOutOrder).toEqual([[2], [3], [1]]);
  });

  it("has no viewer seat for the spectator", () => {
    expect(FFA4_FIXTURES.states.spectator.room.mySeat).toBeNull();
  });

  it("asks for one of 14 Deck cards in the `search` preview pick, to review a long card strip", () => {
    const prompt = ffa4Variant(FFA4_FIXTURES, { out: [], pick: "search" }).states.main.room.engine!.prompt!;
    expect(prompt.kind).toBe("cards");
    expect(prompt.options).toHaveLength(14);
  });
});
