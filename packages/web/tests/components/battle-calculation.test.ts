import { describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { battleCalculation } from "../../src/components/duel/battle-calculation";

const attack: DuelEvent = {
  id: 1, kind: "attack", text: "", zone: { controller: 0, location: 4, sequence: 0 }, target: { controller: 1, location: 4, sequence: 0 },
};
const calculation: DuelEvent = {
  ...attack, id: 2, kind: "battle",
  battle: { attacker: { attack: 200, defense: 900, position: 1 }, target: { attack: 200, defense: 100, position: 1 } },
};

describe("battleCalculation", () => {
  it("reads the matching engine result, including unsorted events and direct attacks", () => {
    expect(battleCalculation([calculation, attack], attack)).toEqual(calculation.battle);
    const direct = { ...calculation, target: undefined, battle: { attacker: calculation.battle!.attacker } };
    expect(battleCalculation([direct], { ...attack, target: undefined })).toEqual(direct.battle);
  });
  it("ignores mismatched zones, earlier results, and results after the next attack or phase", () => {
    expect(battleCalculation([{ ...calculation, zone: attack.target }], attack)).toBeNull();
    expect(battleCalculation([{ ...calculation, target: attack.zone }], attack)).toBeNull();
    expect(battleCalculation([{ ...calculation, id: 0 }], attack)).toBeNull();
    for (const kind of ["attack", "phase"] as const) {
      expect(battleCalculation([{ ...attack, id: 2, kind }, { ...calculation, id: 3 }], attack)).toBeNull();
    }
  });
});
