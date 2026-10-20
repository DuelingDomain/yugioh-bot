import { expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { TYPE_MONSTER } from "../src/components/duel/constants";
import { isHeavySummon, slamStrengthOf } from "../src/components/duel/event-queue";

function summon(attack: number): DuelEvent {
  return { id: 1, kind: "summon", text: "Summoned ? ATK monster", card: { code: 1, name: "? ATK monster", description: "",
    type: TYPE_MONSTER, attack, defense: 0, level: 4, attribute: 1, race: "Dragon" } };
}

it.each([-2, 4294967294])("does not make a low-level ? ATK summon heavy (%s)", attack => {
  expect(isHeavySummon(summon(attack))).toBe(false);
  expect(slamStrengthOf(summon(attack))).toBe(0);
});

it.each([-2, 4294967294])("does not boost a Tribute Summon's slam for ? ATK (%s)", attack => {
  const event = { ...summon(attack), summonKind: "tribute" as const };
  const baseline = { ...summon(0), summonKind: "tribute" as const };
  expect(isHeavySummon(event)).toBe(true);
  expect(slamStrengthOf(event)).toBe(slamStrengthOf(baseline));
});

it("still gives a 2500 ATK summon a heavy slam", () => {
  expect(isHeavySummon(summon(2500))).toBe(true);
  expect(slamStrengthOf(summon(2500))).toBeGreaterThan(0);
});
