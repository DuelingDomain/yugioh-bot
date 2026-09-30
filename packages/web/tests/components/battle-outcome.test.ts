import { describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { battleOutcome } from "@/components/duel/battle-outcome";

const MZONE = 0x04;
const attackerZone = { controller: 0, location: MZONE, sequence: 2 };
const targetZone = { controller: 1, location: MZONE, sequence: 1 };

function event(over: Partial<DuelEvent> & { id: number; kind: DuelEvent["kind"] }): DuelEvent {
  return { text: "", ...over };
}

const attack = event({ id: 10, kind: "attack", seat: 0, zone: attackerZone, target: targetZone });

describe("battleOutcome", () => {
  it("cuts the target when only the target is destroyed", () => {
    const events = [attack, event({ id: 11, kind: "damage", seat: 1, amount: 500, cause: "battle" }), event({ id: 12, kind: "destroy", seat: 1, zone: targetZone })];
    expect(battleOutcome(events, attack)).toEqual({ attacker: false, target: true });
  });

  it("cuts the attacker when a weaker monster attacks into a stronger one", () => {
    const events = [attack, event({ id: 11, kind: "damage", seat: 0, amount: 800, cause: "battle" }), event({ id: 12, kind: "destroy", seat: 0, zone: attackerZone })];
    expect(battleOutcome(events, attack)).toEqual({ attacker: true, target: false });
  });

  it("cuts both on equal ATK", () => {
    const events = [attack, event({ id: 11, kind: "destroy", seat: 0, zone: attackerZone }), event({ id: 12, kind: "destroy", seat: 1, zone: targetZone })];
    expect(battleOutcome(events, attack)).toEqual({ attacker: true, target: true });
  });

  it("cuts nothing when a defender survives", () => {
    const events = [attack, event({ id: 11, kind: "damage", seat: 0, amount: 300, cause: "battle" })];
    expect(battleOutcome(events, attack)).toEqual({ attacker: false, target: false });
  });

  it("ignores destroys from before the attack and from a later attack", () => {
    const later = event({ id: 20, kind: "attack", seat: 0, zone: attackerZone, target: targetZone });
    const events = [
      event({ id: 9, kind: "destroy", seat: 1, zone: targetZone }),
      attack,
      later,
      event({ id: 21, kind: "destroy", seat: 0, zone: attackerZone }),
    ];
    expect(battleOutcome(events, attack)).toEqual({ attacker: false, target: false });
    expect(battleOutcome(events, later)).toEqual({ attacker: true, target: false });
  });

  it("stops at a phase change, so an effect in Main Phase 2 never counts", () => {
    const events = [attack, event({ id: 11, kind: "phase", text: "main2" }), event({ id: 12, kind: "destroy", seat: 1, zone: targetZone })];
    expect(battleOutcome(events, attack)).toEqual({ attacker: false, target: false });
  });

  it("ignores destroys of other cards and destroys without a zone", () => {
    const events = [
      attack,
      event({ id: 11, kind: "destroy", seat: 1, zone: { controller: 1, location: MZONE, sequence: 4 } }),
      event({ id: 12, kind: "destroy", seat: 1 }),
    ];
    expect(battleOutcome(events, attack)).toEqual({ attacker: false, target: false });
  });

  it("reads events in id order even when the window is unsorted", () => {
    const events = [event({ id: 12, kind: "destroy", seat: 1, zone: targetZone }), event({ id: 11, kind: "attack", seat: 0, zone: attackerZone }), attack];
    // The second attack (id 11) comes first, so the destroy at 12 belongs to it, not to id 10.
    expect(battleOutcome(events, attack)).toEqual({ attacker: false, target: false });
  });

  it("direct attacks never cut anything", () => {
    const direct = event({ id: 30, kind: "attack", seat: 0, zone: attackerZone });
    const events = [direct, event({ id: 31, kind: "damage", seat: 1, amount: 1000, cause: "battle" })];
    expect(battleOutcome(events, direct)).toEqual({ attacker: false, target: false });
  });
});
