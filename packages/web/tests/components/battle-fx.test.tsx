// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { DuelEvent, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { BattleFx } from "@/components/duel/battle-fx";
import { AttackConfirm } from "@/components/duel/card-interactions";
import { armLpHold, clearLpHolds, takeLpHold } from "@/components/duel/life-points";
import { isAttackTargetPrompt, isDirectAttackPrompt } from "@/components/duel/prompts";

function prompt(over: Partial<DuelPrompt>): DuelPrompt {
  return { id: "p1", seat: 0, kind: "cards", title: "Select an attack target", options: [], min: 1, max: 1, ...over };
}

describe("attack prompt detection", () => {
  it("recognises the engine's attack-target hint", () => {
    expect(isAttackTargetPrompt(prompt({}))).toBe(true);
    expect(isAttackTargetPrompt(prompt({ title: "Select the target to attack" }))).toBe(true);
    expect(isAttackTargetPrompt(prompt({ title: "Select 1 card(s)" }))).toBe(false);
    expect(isAttackTargetPrompt(prompt({ kind: "choice" }))).toBe(false);
    expect(isAttackTargetPrompt(prompt({ min: 1, max: 2 }))).toBe(false);
    expect(isAttackTargetPrompt(null)).toBe(false);
  });

  it("falls back to opposing monsters only right after an attacker was chosen", () => {
    const opposing = prompt({
      title: "Select 1 card(s)",
      options: [{ id: "card:0", label: "Foe", controller: 1, location: 4, sequence: 0 }],
    });
    expect(isAttackTargetPrompt(opposing)).toBe(false);
    expect(isAttackTargetPrompt(opposing, true)).toBe(true);
    const own = prompt({
      title: "Select 1 card(s)",
      options: [{ id: "card:0", label: "Mine", controller: 0, location: 4, sequence: 0 }],
    });
    expect(isAttackTargetPrompt(own, true)).toBe(false);
  });

  it("recognises the direct attack yes/no", () => {
    const yesNo = prompt({
      kind: "choice",
      title: "Attack directly?",
      options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
    });
    expect(isDirectAttackPrompt(yesNo)).toBe(true);
    expect(isDirectAttackPrompt(prompt({}))).toBe(false);
  });
});

describe("LP hold", () => {
  beforeEach(() => clearLpHolds());

  it("is one-shot, de-duplicated by key, and expires", () => {
    armLpHold(1, 490, "damage-a");
    armLpHold(1, 490, "damage-a");
    expect(takeLpHold(1)).toBe(490);
    expect(takeLpHold(1)).toBe(0);
    armLpHold(1, 490, "damage-a");
    expect(takeLpHold(1)).toBe(0);
    vi.useFakeTimers();
    armLpHold(0, 490, "damage-b");
    vi.advanceTimersByTime(2500);
    expect(takeLpHold(0)).toBe(0);
    vi.useRealTimers();
  });
});

describe("BattleFx", () => {
  let board: HTMLElement;
  const boxes: Record<string, DOMRect> = {
    "0:4:0": { left: 100, top: 400, width: 60, height: 88 } as DOMRect,
    "1:4:0": { left: 100, top: 100, width: 60, height: 88 } as DOMRect,
    lp1: { left: 20, top: 20, width: 200, height: 50 } as DOMRect,
  };

  beforeEach(() => {
    clearLpHolds();
    board = document.createElement("div");
    board.innerHTML = `
      <div data-zones="0:4:0"><div data-card-art></div></div>
      <div data-zones="1:4:0"><div data-card-art></div></div>
      <div data-lp-seat="1"><strong>8000</strong></div>`;
    document.body.appendChild(board);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const zone = this.closest("[data-zones]")?.getAttribute("data-zones");
      const box = zone ? boxes[zone] : this.closest("[data-lp-seat]") ? boxes.lp1 : undefined;
      return (box ?? { left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    board.remove();
  });

  const phase: DuelEvent = { id: 1, kind: "phase", text: "battle" };
  const attack: DuelEvent = {
    id: 2, kind: "attack", seat: 0, text: "attack",
    zone: { controller: 0, location: 4, sequence: 0 },
    target: { controller: 1, location: 4, sequence: 0 },
  };
  const direct: DuelEvent = { ...attack, id: 4, target: undefined };
  const layerPaths = () => document.body.querySelectorAll("svg path");

  it("does not replay events that were already in the first snapshot", () => {
    render(<BattleFx events={[phase, attack]} reducedMotion={false} />);
    act(() => undefined);
    expect(layerPaths()).toHaveLength(0);
  });

  it("plays a fresh attack and arms the LP hold for the damage that follows it", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} />);
    act(() => undefined);
    const damage: DuelEvent = { id: 3, kind: "damage", seat: 1, amount: 800, cause: "battle", text: "" };
    rerender(<BattleFx events={[phase, attack, damage]} reducedMotion={false} />);
    expect(layerPaths().length).toBeGreaterThan(0);
    // The target card is copied into two clipped halves for the cut.
    expect(document.body.querySelectorAll("div[style*='clip-path']")).toHaveLength(2);
    expect(takeLpHold(1)).toBeGreaterThan(0);
  });

  it("plays only the newest attack of a burst", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} />);
    act(() => undefined);
    rerender(<BattleFx events={[phase, attack, direct]} reducedMotion={false} />);
    // The newest attack is the direct one: there is no card to cut.
    expect(layerPaths().length).toBeGreaterThan(0);
    expect(document.body.querySelectorAll("div[style*='clip-path']")).toHaveLength(0);
  });

  it("does not arm the LP hold under reduced motion", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion />);
    act(() => undefined);
    const damage: DuelEvent = { id: 3, kind: "damage", seat: 1, amount: 800, cause: "battle", text: "" };
    rerender(<BattleFx events={[phase, attack, damage]} reducedMotion />);
    expect(takeLpHold(1)).toBe(0);
  });
});

describe("AttackConfirm", () => {
  it("confirms with Enter, backs out with Escape, and only the primary button attacks", () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(<AttackConfirm anchor={anchor} targetName="Blue-Eyes" busy={false} prefer="above" onConfirm={onConfirm} onBack={onBack} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Attack Blue-Eyes" }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
