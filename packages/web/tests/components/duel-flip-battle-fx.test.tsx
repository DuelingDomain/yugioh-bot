// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { BattleFx } from "@/components/duel/battle-fx";
import { clearBattleHolds } from "@/components/duel/battle-hold";
import { planChainBeats, resetChainBeats } from "@/components/duel/chain-beats";
import { duelFxClock } from "@/components/duel/fx-clock";
import { flipSequenceSteps } from "@/components/duel/flip-sequence";
import { clearLpHolds, takeLpHold } from "@/components/duel/life-points";

const A = { controller: 0, location: 4, sequence: 0 };
const D = { controller: 1, location: 4, sequence: 0 };
const G = (controller: number) => ({ controller, location: 16, sequence: 0 });

const phase: DuelEvent = { id: 1, kind: "phase", text: "battle" };
const attack: DuelEvent = { id: 2, kind: "attack", seat: 0, text: "attack", zone: A, target: D };
const flip: DuelEvent = { id: 3, kind: "position", seat: 1, text: "flipped", zone: D, flip: true, fromPosition: 8, toPosition: 4 };
const calc: DuelEvent = { id: 4, kind: "battle", seat: 0, text: "calc", zone: A, target: D };
// The engine calculates the damage before the activation (processor.cpp: attack, flip, battle, damage, activate).
const hurt: DuelEvent = { id: 5, kind: "damage", seat: 0, amount: 300, cause: "battle", text: "damage" };
const activate: DuelEvent = { id: 6, kind: "activate", seat: 1, text: "activating", zone: D, chainIndex: 1 };
const target: DuelEvent = { id: 7, kind: "target", seat: 1, text: "targets", chainIndex: 1, targets: [{ controller: 0, location: 4, sequence: 1 }] };
const resolving: DuelEvent = { id: 8, kind: "chain-resolving", seat: 1, text: "resolving", chainIndex: 1 };
const resolved: DuelEvent = { id: 9, kind: "chain-resolved", seat: 1, text: "resolved", chainIndex: 1 };
const chainEnd: DuelEvent = { id: 10, kind: "chain-end", text: "end" };
// A 300 ATK attacker meets a flipped 600 DEF card: the attacker is hurt and survives.
const battleEnd: DuelEvent = { id: 11, kind: "battle-end", text: "end" };

const seats = [
  { seat: 0, monsters: [{ ...A, position: 1, code: 70095154, name: "Cyber Dragon", attack: 300, defense: 600 }] },
  { seat: 1, monsters: [{ ...D, position: 4, code: 54652250, name: "Man-Eater Bug", attack: 450, defense: 600 }] },
] as unknown as DuelSeatView[];

describe("BattleFx with a flip-effect sequence", () => {
  let board: HTMLElement;
  beforeEach(() => {
    clearLpHolds();
    clearBattleHolds();
    resetChainBeats("flip-fx");
    board = document.createElement("div");
    board.innerHTML = `
      <div data-zones="0:4:0"><div data-card-art></div></div>
      <div data-zones="1:4:0"><div data-card-art></div></div>
      <div data-lp-seat="0"><strong>8000</strong></div>`;
    document.body.appendChild(board);
    const boxes: Record<string, DOMRect> = {
      "0:4:0": { left: 100, top: 400, width: 60, height: 88 } as DOMRect,
      "1:4:0": { left: 100, top: 100, width: 60, height: 88 } as DOMRect,
      lp0: { left: 20, top: 520, width: 200, height: 50 } as DOMRect,
    };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const zone = this.closest("[data-zones]")?.getAttribute("data-zones");
      const box = zone ? boxes[zone] : this.closest("[data-lp-seat]") ? boxes.lp0 : undefined;
      return (box ?? { left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    board.remove();
  });

  const plan = (events: DuelEvent[], reduced = false) => planChainBeats(events, { now: duelFxClock.now(), reduced, duelKey: "flip-fx" });
  const strike = () => document.body.querySelector("[data-flip-strike]");
  const playLayer = () => document.body.querySelector("[data-style]");

  it("shows the strike and builds no attack play when the whole fight is one batch", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    const all = [phase, attack, flip, calc, hurt, activate, target, resolving, resolved, chainEnd, battleEnd];
    plan(all);
    rerender(<BattleFx events={all} reducedMotion={false} seats={seats} />);
    expect(strike()).not.toBeNull();
    expect(playLayer()).toBeNull();
  });

  it("starts the strike with the attack and builds no attack play when the activation comes in a later batch", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    const declared = [phase, attack];
    plan(declared);
    rerender(<BattleFx events={declared} reducedMotion={false} seats={seats} />);
    expect(strike()).toBeNull();
    const opened = [...declared, flip, calc, hurt, activate];
    plan(opened);
    rerender(<BattleFx events={opened} reducedMotion={false} seats={seats} />);
    expect(strike()).not.toBeNull();
    const rest = [...opened, target, resolving, resolved, chainEnd, battleEnd];
    plan(rest);
    rerender(<BattleFx events={rest} reducedMotion={false} seats={seats} />);
    expect(playLayer()).toBeNull();
  });

  it("holds the LP roll of the battle damage until the strike hits", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    const all = [phase, attack, flip, calc, hurt, activate, target, resolving, resolved, chainEnd, battleEnd];
    plan(all);
    rerender(<BattleFx events={all} reducedMotion={false} seats={seats} />);
    // The damage comes before the activation in the engine's order; it rolls at the hit of the strike.
    const hold = takeLpHold(0);
    expect(hold).toBeGreaterThan(100);
    expect(hold).toBeLessThanOrEqual(flipSequenceSteps(false).attackMs);
  });

  it("plays the normal battle when the calculation came in an earlier call than the activation", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    const early = [phase, attack, flip, calc];
    plan(early);
    rerender(<BattleFx events={early} reducedMotion={false} seats={seats} />);
    const opened = [...early, hurt, activate];
    plan(opened);
    rerender(<BattleFx events={opened} reducedMotion={false} seats={seats} />);
    expect(strike()).toBeNull();
  });

  it("holds no LP roll for effect damage, which belongs to no flip sequence", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    const effectDamage: DuelEvent = { id: 3, kind: "damage", seat: 0, amount: 500, cause: "effect", text: "effect damage" };
    const events = [phase, effectDamage];
    plan(events);
    rerender(<BattleFx events={events} reducedMotion={false} seats={seats} />);
    expect(takeLpHold(0)).toBe(0);
  });

  it("still plays a normal attack in full and rolls its damage with the strike", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    const normal = [phase, attack, hurt];
    plan(normal);
    rerender(<BattleFx events={normal} reducedMotion={false} seats={seats} />);
    expect(strike()).toBeNull();
    expect(playLayer()).not.toBeNull();
  });

  it("keeps only the short marker under reduced motion", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion seats={seats} />);
    const all = [phase, attack, flip, calc, hurt, activate, target, resolving, resolved, chainEnd, battleEnd];
    plan(all, true);
    rerender(<BattleFx events={all} reducedMotion seats={seats} />);
    expect(strike()?.getAttribute("data-reduced")).toBe("true");
    expect(strike()?.querySelector("[data-strike-body]")).toBeNull();
    expect(playLayer()).toBeNull();
  });
});
