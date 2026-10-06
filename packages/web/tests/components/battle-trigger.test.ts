import { describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { battleTrigger, CLASH_MAX_AGE_MS } from "../../src/components/duel/battle-trigger";

const MZONE = 0x04;
const z = (controller: number, sequence: number): DuelZoneRef => ({ controller, location: MZONE, sequence });
const attacker = z(0, 0);
const target = z(1, 0);

const attack: DuelEvent = { id: 10, kind: "attack", seat: 0, text: "attack", zone: attacker, target };
const directAttack: DuelEvent = { id: 10, kind: "attack", seat: 0, text: "attack", zone: attacker };
const ev = (id: number, over: Partial<DuelEvent>): DuelEvent => ({ id, text: "", ...over }) as DuelEvent;
const damage = (id: number, seat: number, cause: DuelEvent["cause"] = "battle") => ev(id, { kind: "damage", seat, amount: 500, cause });
const destroy = (id: number, zone: DuelZoneRef, cause: DuelEvent["cause"] = "battle") => ev(id, { kind: "destroy", zone, cause });
const phase = (id: number) => ev(id, { kind: "phase" });
const activate = (id: number) => ev(id, { kind: "activate", zone: z(0, 3) });

describe("battleTrigger", () => {
  it.each([["monster", attack], ["direct", directAttack]])("fizzles a %s attack at once when the engine says it was negated", (_name, declared) => {
    const negated = ev(12, { kind: "attack-negated" });
    expect(battleTrigger([declared, activate(11), negated], declared)).toEqual({ action: "fizzle", reason: "negated" });
    expect(battleTrigger([declared, negated], declared)).toEqual({ action: "fizzle", reason: "negated" });
    // A negate that came before this attack is not this attack's.
    expect(battleTrigger([ev(5, { kind: "attack-negated" }), declared], declared)).toEqual({ action: "wait" });
  });

  it("plays a calculated battle even when neither damage nor destruction occurs", () => {
    const calculation = ev(11, {
      kind: "battle", zone: attacker, target,
      battle: { attacker: { attack: 200, defense: 900, position: 1 }, target: { attack: 100, defense: 200, position: 4 } },
    });
    expect(battleTrigger([attack, calculation], attack)).toEqual({ action: "wait" });
    expect(battleTrigger([attack, calculation, ev(12, { kind: "battle-end" })], attack)).toEqual({ action: "play", reason: "calculation" });
    expect(battleTrigger([attack, { ...calculation, zone: z(0, 2) }], attack)).toEqual({ action: "wait" });
  });

  it.each(["before", "after"])("plays a confirmed calculation after an activation %s calculation", when => {
    const calculation = ev(when === "before" ? 12 : 11, {
      kind: "battle", zone: attacker, target,
      battle: { attacker: { attack: 200, defense: 900, position: 1 }, target: { attack: 100, defense: 200, position: 4 } },
    });
    const response = activate(when === "before" ? 11 : 12);
    expect(battleTrigger([attack, calculation, response, ev(13, { kind: "battle-end" })], attack)).toEqual({ action: "play", reason: "calculation" });
  });

  it("plays calculation-only completion after a long response window", () => {
    const calculation = ev(11, {
      kind: "battle", zone: attacker, target,
      battle: { attacker: { attack: 200, defense: 900, position: 1 }, target: { attack: 100, defense: 200, position: 4 } },
    });
    const events = [attack, calculation, ev(12, { kind: "battle-end" })];
    expect(battleTrigger(events, attack, CLASH_MAX_AGE_MS)).toEqual({ action: "play", reason: "calculation" });
    expect(battleTrigger(events, attack, CLASH_MAX_AGE_MS + 1)).toEqual({ action: "play", reason: "calculation" });
  });

  it.each(["damage", "destroy"] as const)("still plays actual battle %s after a response and the clash age limit", kind => {
    const calculation = ev(12, {
      kind: "battle", zone: attacker, target,
      battle: { attacker: { attack: 200, defense: 900, position: 1 }, target: { attack: 100, defense: 100, position: 4 } },
    });
    const resolved = kind === "damage" ? damage(13, 1) : destroy(13, target);
    expect(battleTrigger([attack, activate(11), calculation, resolved, ev(14, { kind: "battle-end" })], attack, CLASH_MAX_AGE_MS + 1)).toEqual({ action: "play", reason: kind });
  });

  it("waits through calculation and recognizes casualties moved before battle destruction", () => {
    const calculation = ev(11, { kind: "battle", zone: attacker, target,
      battle: { attacker: { attack: 200, defense: 900, position: 1 }, target: { attack: 200, defense: 100, position: 1 } } });
    const casualty = ev(12, { kind: "move", from: attacker, zone: { controller: 0, location: 16, sequence: 0 }, reason: "destroy", cause: "battle" });
    expect(battleTrigger([attack, calculation], attack)).toEqual({ action: "wait" });
    expect(battleTrigger([attack, calculation, casualty, destroy(13, attacker), destroy(14, target)], attack)).toEqual({ action: "play", reason: "destroy" });
  });
  it("waits at the declaration, while the duel stops for responses", () => {
    expect(battleTrigger([attack], attack)).toEqual({ action: "wait" });
    expect(battleTrigger([phase(9), attack], attack)).toEqual({ action: "wait" });
    // an effect chained in the window does not start or end the fight
    expect(battleTrigger([attack, activate(11), ev(12, { kind: "chain-resolved" })], attack)).toEqual({ action: "wait" });
  });

  it("plays on battle damage", () => {
    expect(battleTrigger([attack, damage(11, 1)], attack)).toEqual({ action: "play", reason: "damage" });
    expect(battleTrigger([directAttack, damage(11, 1)], directAttack)).toEqual({ action: "play", reason: "damage" });
    // damage with no cause (an older replay) counts
    expect(battleTrigger([attack, damage(11, 1, undefined)], attack)).toEqual({ action: "play", reason: "damage" });
  });

  it("plays on a battle destroy of the target or of the attacker", () => {
    expect(battleTrigger([attack, destroy(11, target)], attack)).toEqual({ action: "play", reason: "destroy" });
    expect(battleTrigger([attack, destroy(11, attacker)], attack)).toEqual({ action: "play", reason: "destroy" });
  });

  it("does not start on effect or cost damage in a response window", () => {
    expect(battleTrigger([attack, damage(11, 1, "effect"), damage(12, 0, "cost")], attack)).toEqual({ action: "wait" });
    expect(battleTrigger([attack, activate(11), damage(12, 1, "effect"), damage(13, 1)], attack)).toEqual({ action: "play", reason: "damage" });
  });

  it("still plays when an effect was used in the window and the fight went on (an ATK boost)", () => {
    expect(battleTrigger([attack, activate(11), ev(12, { kind: "chain-resolved" }), damage(13, 1), destroy(14, target)], attack)).toEqual({
      action: "play",
      reason: "damage",
    });
  });

  it("fizzles when the attacker leaves before the damage (Mirror Force, bounce, banish)", () => {
    expect(battleTrigger([attack, activate(11), destroy(12, attacker, "effect")], attack)).toEqual({ action: "fizzle", reason: "attacker-left" });
    expect(battleTrigger([attack, ev(11, { kind: "move", from: attacker, zone: z(0, 5), reason: "return" })], attack)).toEqual({
      action: "fizzle",
      reason: "attacker-left",
    });
  });

  it("fizzles when the target leaves before the damage", () => {
    expect(battleTrigger([attack, destroy(11, target, "effect")], attack)).toEqual({ action: "fizzle", reason: "target-left" });
  });

  it("fizzles a negated attack: an effect was used and the battle ended with nothing", () => {
    expect(battleTrigger([attack, activate(11), ev(12, { kind: "chain-resolved" }), phase(13)], attack)).toEqual({ action: "fizzle", reason: "negated" });
    expect(battleTrigger([attack, activate(11), ev(12, { kind: "attack", zone: z(0, 1), target })], attack)).toEqual({ action: "fizzle", reason: "negated" });
  });

  it("fizzles a direct attack that dealt no damage", () => {
    expect(battleTrigger([directAttack, phase(11)], directAttack)).toEqual({ action: "fizzle", reason: "no-battle" });
  });

  it("shows only a short clash for a battle that left no damage and no destroy, once the next event closes it", () => {
    expect(battleTrigger([attack, phase(11)], attack)).toEqual({ action: "play", reason: "clash" });
    expect(battleTrigger([attack, ev(11, { kind: "attack", zone: z(0, 1), target })], attack)).toEqual({ action: "play", reason: "clash" });
    expect(battleTrigger([attack, phase(11)], attack, CLASH_MAX_AGE_MS + 1)).toEqual({ action: "fizzle", reason: "stale" });
  });

  it("ignores events from before the attack and reads an unsorted list in id order", () => {
    expect(battleTrigger([destroy(5, target), damage(6, 1), attack], attack)).toEqual({ action: "wait" });
    expect(battleTrigger([phase(13), damage(12, 1), attack], attack)).toEqual({ action: "play", reason: "damage" });
  });

  it("is a fizzle for something that is not an attack", () => {
    expect(battleTrigger([phase(1)], phase(1))).toEqual({ action: "fizzle", reason: "no-battle" });
  });
});
