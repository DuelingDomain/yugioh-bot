import { describe, expect, it } from "vitest";
import { BATTLE_EFFECT_SCENARIOS } from "../../src/components/duel/fx-lab/battle-effect-scenarios";
import { applyEdits, numberSteps } from "../../src/components/duel/fx-lab/board";
import { findFlipSequences } from "../../src/components/duel/flip-sequence";
import { findScenario } from "../../src/components/duel/fx-lab/scenarios";

describe("battle effect lab scenes", () => {
  it("turns an Enemy Controller target before attacking and destroying it in defense", () => {
    const scene = BATTLE_EFFECT_SCENARIOS.find(s => s.id === "battle-enemy-controller-defender")!.build();
    const events = scene.steps.flatMap(s => s.events ?? []);
    expect(events.findIndex(e => e.kind === "position")).toBeLessThan(events.findIndex(e => e.kind === "attack"));
    expect(events.find(e => e.kind === "battle")?.battle?.target?.position).toBe(4);
    expect(events.find(e => e.kind === "destroy")?.fromPosition).toBe(4);
    expect(events.find(e => e.kind === "move" && e.reason === "destroy")?.fromPosition).toBe(4);
    expect(events.some(e => e.kind === "damage")).toBe(false);
  });
  it.each(BATTLE_EFFECT_SCENARIOS)("registers $id at its FX-lab hash", scene => {
    expect(findScenario(scene.id)).toBe(scene);
  });
  it.each([false, true])("keeps calculation and final board stats distinct (boosted: %s)", boosted => {
    const scene = BATTLE_EFFECT_SCENARIOS.find(s => s.id === `battle-cats-ear-tribe${boosted ? "-equipped" : ""}`)!.build();
    const events = scene.steps.flatMap(s => s.events ?? []);
    expect(events.find(e => e.kind === "battle")?.battle?.attacker.attack).toBe(boosted ? 1200 : 200);
    expect(events.filter(e => e.kind === "damage").map(e => e.amount)).toEqual(boosted ? [1000] : []);
    const final = scene.steps.reduce((board, step) => applyEdits(board, step.edits ?? []), scene.initial);
    expect(final.seats[1].lp).toBe(boosted ? 7000 : 8000);
    expect(final.seats[0].monsters[2]?.attack).toBe(boosted ? 2900 : undefined);
    expect(final.seats[1].monsters[2]).toBeNull();
  });
  it("turns the opposing attacker with Enemy Controller without creating battle damage", () => {
    const scene = BATTLE_EFFECT_SCENARIOS.find(s => s.id === "battle-enemy-controller")!.build();
    const events = scene.steps.flatMap(s => s.events ?? []);
    expect(events.some(e => e.kind === "damage" || e.kind === "battle")).toBe(false);
    expect(events.find(e => e.kind === "position")).toMatchObject({ zone: { controller: 1, location: 4, sequence: 2 }, fromPosition: 1, toPosition: 4 });
    const final = scene.steps.reduce((board, step) => applyEdits(board, step.edits ?? []), scene.initial);
    expect(final.seats[1].monsters[2]?.position).toBe(4);
  });
  it.each(["battle-flip-effect-attack", "battle-flip-effect-attack-opponent"])("replays the flip-effect fight of %s in one batch and ends with both monsters in the graves", id => {
    const scene = BATTLE_EFFECT_SCENARIOS.find(s => s.id === id)!.build();
    const events = numberSteps(scene.steps, 0).flatMap(n => n.events);
    expect(findFlipSequences(events)).toHaveLength(1);
    expect(scene.steps.filter(s => (s.events ?? []).length > 0)).toHaveLength(1);
    const final = scene.steps.reduce((board, step) => applyEdits(board, step.edits ?? []), scene.initial);
    for (const seat of final.seats) {
      expect(seat.monsters.every(m => m == null)).toBe(true);
      expect(seat.graveyard.length).toBe(1);
    }
  });
  it("lets the attacker survive when the Bug's effect marks another monster, and the fight ends after the chain", () => {
    const scene = BATTLE_EFFECT_SCENARIOS.find(s => s.id === "battle-flip-effect-bystander")!.build();
    const events = numberSteps(scene.steps, 0).flatMap(n => n.events);
    const [sequence] = findFlipSequences(events);
    expect(sequence).toBeDefined();
    expect(sequence.effects.length).toBeGreaterThan(0);
    expect(sequence.aftermath.length).toBeGreaterThan(0);
    expect(sequence.target?.targets).toEqual([{ controller: 0, location: 4, sequence: 3 }]);
    const final = scene.steps.reduce((board, step) => applyEdits(board, step.edits ?? []), scene.initial);
    expect(final.seats[0].monsters[2]?.name).toBe("Cyber Dragon");
    expect(final.seats[0].monsters[3]).toBeNull();
    expect(final.seats[0].graveyard.length).toBe(1);
    expect(final.seats[1].monsters[2]).toBeNull();
  });
});
