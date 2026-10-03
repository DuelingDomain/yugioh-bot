import { describe, expect, it } from "vitest";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";

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
});
