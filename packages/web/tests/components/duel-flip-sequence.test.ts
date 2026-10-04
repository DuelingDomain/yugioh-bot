import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { findFlipSequences, flipSequenceOf, flipSequenceSteps, FLIP_SEQUENCE_TIMING } from "../../src/components/duel/flip-sequence";
import { chainBeatAt, chainEffectAt, flipAttackAt, isSequenceFlip, planChainBeats, resetChainBeats } from "../../src/components/duel/chain-beats";
import { chainEffectLead, deriveChainState } from "../../src/components/duel/chain-state";
import { targetLinksOf } from "../../src/components/duel/chain-fx";

const MZONE = 4;
const GRAVE = 16;
const zone = (controller: number, location = MZONE, sequence = 0): DuelZoneRef => ({ controller, location, sequence });

/** The engine batch recorded for: Cyber Dragon attacks a face-down Man-Eater Bug (ids 5 to 18). */
function recorded(attacker = 0, defender = 1): DuelEvent[] {
  const a = zone(attacker);
  const d = zone(defender);
  return [
    { id: 5, kind: "attack", seat: attacker, zone: a, target: d, text: "Player declares an attack" },
    { id: 6, kind: "position", seat: defender, card: "Man-Eater Bug", zone: d, flip: true, fromPosition: 8, toPosition: 4, text: "flipped" },
    { id: 7, kind: "battle", seat: attacker, zone: a, target: d, text: "Damage calculation" },
    { id: 8, kind: "activate", seat: defender, card: "Man-Eater Bug", zone: d, chainIndex: 1, text: "activating" },
    { id: 9, kind: "target", seat: defender, targets: [a], chainIndex: 1, text: "targets 1 card" },
    { id: 10, kind: "chain-resolving", seat: defender, chainIndex: 1, text: "resolving" },
    { id: 11, kind: "move", seat: attacker, card: "Cyber Dragon", zone: zone(attacker, GRAVE), from: a, cause: "effect", reason: "destroy", fromPosition: 1, text: "moved" },
    { id: 12, kind: "target", seat: defender, targets: [zone(attacker, GRAVE)], chainIndex: 1, text: "targets 1 card" },
    { id: 13, kind: "chain-resolved", seat: defender, chainIndex: 1, text: "resolved" },
    { id: 14, kind: "destroy", seat: attacker, card: "Cyber Dragon", zone: a, cause: "effect", fromPosition: 1, text: "destroyed" },
    { id: 15, kind: "chain-end", text: "Chain ended" },
    { id: 16, kind: "move", seat: defender, card: "Man-Eater Bug", zone: zone(defender, GRAVE), from: d, cause: "battle", reason: "destroy", fromPosition: 4, text: "moved" },
    { id: 17, kind: "destroy", seat: defender, card: "Man-Eater Bug", zone: d, cause: "battle", fromPosition: 4, text: "destroyed" },
    { id: 18, kind: "battle-end", text: "Damage Step ended" },
  ] as DuelEvent[];
}

const NOW = 5000;
const plan = (events: DuelEvent[], reduced = false, now = NOW) => planChainBeats(events, { now, reduced, duelKey: "flip" });
const at = (events: DuelEvent[], id: number) => chainEffectAt(id) || chainBeatAt(id);

beforeEach(() => resetChainBeats("flip"));

describe("findFlipSequences", () => {
  it("finds the recorded flip-effect fight and its parts", () => {
    const [sequence] = findFlipSequences(recorded());
    expect(sequence.attack.id).toBe(5);
    expect(sequence.flip.id).toBe(6);
    expect(sequence.activate.id).toBe(8);
    expect(sequence.target?.id).toBe(9);
    expect(sequence.resolving?.id).toBe(10);
    expect(sequence.chainEnd?.id).toBe(15);
    expect(sequence.attackerLeft.id).toBe(11);
    expect(sequence.effects.map((e) => e.id)).toEqual([11, 14]);
    expect(sequence.aftermath.map((e) => e.id)).toEqual([16, 17]);
    expect(flipSequenceOf(recorded(), 5)?.flip.id).toBe(6);
    expect(flipSequenceOf(recorded(), 99)).toBeNull();
  });

  it("works for the opponent's attack and for other seats of a multi-seat table", () => {
    expect(findFlipSequences(recorded(1, 0))).toHaveLength(1);
    expect(findFlipSequences(recorded(2, 0))[0].attackerLeft.id).toBe(11);
    expect(findFlipSequences(recorded(0, 3))[0].aftermath.map((e) => e.id)).toEqual([16, 17]);
  });

  it("ignores a normal attack that ends in a battle destroy", () => {
    const a = zone(0);
    const d = zone(1);
    const events = [
      { id: 1, kind: "attack", seat: 0, zone: a, target: d, text: "attack" },
      { id: 2, kind: "battle", seat: 0, zone: a, target: d, text: "calc" },
      { id: 3, kind: "destroy", seat: 1, zone: d, cause: "battle", text: "destroyed" },
      { id: 4, kind: "battle-end", text: "end" },
    ] as DuelEvent[];
    expect(findFlipSequences(events)).toEqual([]);
  });

  it("ignores a direct attack", () => {
    const events = [{ id: 1, kind: "attack", seat: 0, zone: zone(0), text: "attack" }, { id: 2, kind: "damage", seat: 1, text: "damage" }] as DuelEvent[];
    expect(findFlipSequences(events)).toEqual([]);
  });

  it("ignores a flip effect that does not remove the attacker (the old behavior stays)", () => {
    const kept = recorded().filter((e) => e.id !== 11 && e.id !== 14);
    expect(findFlipSequences(kept)).toEqual([]);
  });

  it("ignores a flip with no activation", () => {
    expect(findFlipSequences(recorded().filter((e) => e.kind !== "activate"))).toEqual([]);
  });

  it("does not run a window into the next attack", () => {
    const next = { id: 6, kind: "attack", seat: 0, zone: zone(0), target: zone(1), text: "attack" } as DuelEvent;
    const events = recorded().filter((e) => e.id <= 5).concat(next, recorded().filter((e) => e.id > 6).map((e) => ({ ...e, id: e.id + 10 })));
    expect(findFlipSequences(events)).toEqual([]);
  });
});

describe("flip sequence timing", () => {
  it("lays the beats in order, each after the one before: attack, flip, activate, target, destroy, aftermath", () => {
    const events = recorded();
    plan(events);
    const steps = flipSequenceSteps(false);
    expect(flipAttackAt(5)).toBe(NOW);
    expect(at(events, 6) - flipAttackAt(5)).toBe(steps.attackMs);
    expect(at(events, 8) - at(events, 6)).toBe(steps.flipMs);
    expect(isSequenceFlip(6)).toBe(true);
    const order = [flipAttackAt(5), at(events, 6), at(events, 8), chainBeatAt(9), chainBeatAt(10), at(events, 11), chainBeatAt(15), at(events, 16)];
    for (let i = 1; i < order.length; i += 1) expect(order[i]).toBeGreaterThan(order[i - 1]);
    // The target is marked for its whole step before the link resolves.
    expect(chainBeatAt(10) - chainBeatAt(9)).toBe(steps.targetMs);
    // The destroy of the attacker comes after the resolving badge, never before.
    expect(at(events, 11)).toBe(chainBeatAt(10) + chainEffectLead(false));
    expect(at(events, 14)).toBe(chainBeatAt(10) + chainEffectLead(false));
    // The battle death of the flipped card waits for the chain end.
    expect(at(events, 17)).toBe(at(events, 16));
    expect(at(events, 16)).toBeGreaterThanOrEqual(chainBeatAt(15));
  });

  it("keeps the wanted pace in virtual ms (the FX speed clock scales it)", () => {
    expect(FLIP_SEQUENCE_TIMING.attackMs).toBeGreaterThanOrEqual(350);
    expect(FLIP_SEQUENCE_TIMING.attackMs).toBeLessThanOrEqual(450);
    expect(FLIP_SEQUENCE_TIMING.flipMs).toBe(300);
    expect(FLIP_SEQUENCE_TIMING.targetMs).toBe(500);
  });

  it("uses shorter steps under reduced motion but keeps the order", () => {
    const events = recorded();
    plan(events, true);
    const steps = flipSequenceSteps(true);
    expect(steps.attackMs).toBeLessThan(flipSequenceSteps(false).attackMs);
    expect(at(events, 6) - flipAttackAt(5)).toBe(steps.attackMs);
    expect(at(events, 8) - at(events, 6)).toBe(steps.flipMs);
    expect(chainBeatAt(10) - chainBeatAt(9)).toBe(steps.targetMs);
    expect(at(events, 11)).toBeGreaterThan(chainBeatAt(10) - 1);
  });

  it("is idempotent: a second layer planning the same batch keeps the times", () => {
    const events = recorded();
    plan(events);
    const before = events.map((e) => at(events, e.id));
    plan(events, false, NOW + 9000);
    expect(events.map((e) => at(events, e.id))).toEqual(before);
    expect(flipAttackAt(5)).toBe(NOW);
  });

  it("starts after chain beats that are still queued", () => {
    plan([{ id: 1, kind: "chain-resolving", chainIndex: 1, text: "r" } as DuelEvent]);
    const events = recorded();
    plan(events, false, NOW + 10);
    expect(flipAttackAt(5)).toBeGreaterThan(NOW + 10);
  });

  it("leaves a normal attack and a direct attack unplanned", () => {
    const normal = [
      { id: 21, kind: "attack", seat: 0, zone: zone(0), target: zone(1), text: "a" },
      { id: 22, kind: "battle", seat: 0, text: "calc" },
      { id: 23, kind: "destroy", seat: 1, zone: zone(1), cause: "battle", text: "d" },
      { id: 24, kind: "attack", seat: 0, zone: zone(0), text: "direct" },
    ] as DuelEvent[];
    plan(normal);
    for (const e of normal) {
      expect(flipAttackAt(e.id)).toBe(0);
      expect(chainEffectAt(e.id)).toBe(0);
      expect(isSequenceFlip(e.id)).toBe(false);
    }
  });
});

describe("held target mark", () => {
  it("keeps the target of a flip link while it resolves and drops it when the link is resolved", () => {
    const events = recorded();
    const sequenced = new Set([1]);
    const held = new Map();
    const through = (upTo: number) => deriveChainState(events.filter((e) => e.id <= upTo));
    // After chain-end the live state is empty, yet the played state still shows the link resolving.
    const resolving = through(10);
    const live = deriveChainState(events);
    expect(targetLinksOf(live, resolving, sequenced, held).map((l) => l.index)).toEqual([1]);
    expect(held.get(1)?.[0]).toEqual(zone(0));
    // The target the engine re-publishes in the grave does not replace the held mark.
    const moved = through(12);
    expect(targetLinksOf(live, moved, sequenced, held)[0].targets[0]).toEqual(zone(0));
    // A link that is not part of a flip sequence is not held.
    expect(targetLinksOf(live, resolving, new Set(), new Map())).toEqual([]);
    // Resolved: the mark goes.
    const resolved = { ...moved, links: moved.links.map((l) => ({ ...l, status: "resolved" as const })) };
    expect(targetLinksOf(live, resolved, sequenced, held)).toEqual([]);
    expect(held.has(1)).toBe(false);
  });
});
