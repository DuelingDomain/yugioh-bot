// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { DuelEvent, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { COUNTER_GAP_MS, COUNTER_SCALE, DESTROY_BEAT_MS, MAX_BATTLE_MS } from "@/components/duel/attack-styles";
import { BattleFx } from "@/components/duel/battle-fx";
import { battleDestroyAt, clearBattleHolds } from "@/components/duel/battle-hold";
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
  /** Battle damage to the defender: the fight resolved and nobody was destroyed. */
  const hurt: DuelEvent = { id: 3, kind: "damage", seat: 1, amount: 300, cause: "battle", text: "" };
  const layerPaths = () => document.body.querySelectorAll("svg path");
  const playLayer = () => document.body.querySelector("[data-style]");

  /** Engine-view seats with one monster per side (attacker seat 0, defender seat 1). */
  const seatsOf = (
    attacker: { code?: number; name?: string; race?: string; attribute?: number },
    defender: { code?: number; name?: string; race?: string; attribute?: number },
    defenderPosition = 1,
  ): DuelSeatView[] =>
    [
      { seat: 0, monsters: [{ controller: 0, location: 4, sequence: 0, position: 1, ...attacker }] },
      { seat: 1, monsters: [{ controller: 1, location: 4, sequence: 0, position: defenderPosition, ...defender }] },
    ] as unknown as DuelSeatView[];
  // A Warrior (slash: two halves), a Machine (beam: 24 tiles) and a Spellcaster (arcane: 24 tiles).
  const warrior = { code: 6368038, name: "Gaia The Fierce Knight", race: "Warrior", attribute: 1 };
  const machine = { code: 77585513, name: "Jinzo", race: "Machine", attribute: 32 };

  it("does not replay events that were already in the first snapshot", () => {
    render(<BattleFx events={[phase, attack]} reducedMotion={false} />);
    act(() => undefined);
    expect(layerPaths()).toHaveLength(0);
  });

  const cutRoles = () => Array.from(document.body.querySelectorAll("[data-role]")).map((el) => el.getAttribute("data-role"));
  const halves = () => document.body.querySelectorAll("div[style*='clip-path']");

  it("plays a fresh attack, cuts the destroyed target and arms the LP hold for the damage that follows it", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seatsOf(warrior, machine)} />);
    act(() => undefined);
    const damage: DuelEvent = { id: 3, kind: "damage", seat: 1, amount: 800, cause: "battle", text: "" };
    const destroyed: DuelEvent = { id: 4, kind: "destroy", seat: 1, text: "", zone: { controller: 1, location: 4, sequence: 0 } };
    rerender(<BattleFx events={[phase, attack, damage, destroyed]} reducedMotion={false} seats={seatsOf(warrior, machine)} />);
    expect(layerPaths().length).toBeGreaterThan(0);
    // The attacker is a Warrior: the target card is copied into two clipped halves for the slash.
    expect(playLayer()?.getAttribute("data-style")).toBe("slash");
    expect(halves()).toHaveLength(2);
    expect(cutRoles()).toEqual(["target"]);
    expect(takeLpHold(1)).toBeGreaterThan(0);
  });

  it("cuts the attacker when a weaker monster attacks into a stronger one", () => {
    const seats = seatsOf(warrior, machine);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    act(() => undefined);
    const damage: DuelEvent = { id: 3, kind: "damage", seat: 0, amount: 500, cause: "battle", text: "" };
    const destroyed: DuelEvent = { id: 4, kind: "destroy", seat: 0, text: "", zone: { controller: 0, location: 4, sequence: 0 } };
    rerender(<BattleFx events={[phase, attack, damage, destroyed]} reducedMotion={false} seats={seats} />);
    // The defender (a Machine) strikes back in its own style, and it is the attacker that breaks up.
    expect(playLayer()?.getAttribute("data-style")).toBe("slash");
    expect(playLayer()?.getAttribute("data-counter-style")).toBe("beam");
    expect(halves()).toHaveLength(24);
    expect(cutRoles()).toEqual(["attacker"]);
    // The slash still lands on the target, so the attacker's LP roll waits for the impact too.
    expect(takeLpHold(0)).toBeGreaterThan(0);
  });

  it("cuts both cards on equal ATK and neither when the defender holds", () => {
    const seats = seatsOf(warrior, machine);
    const { rerender, unmount } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    act(() => undefined);
    const lostA: DuelEvent = { id: 3, kind: "destroy", seat: 0, text: "", zone: { controller: 0, location: 4, sequence: 0 } };
    const lostB: DuelEvent = { id: 4, kind: "destroy", seat: 1, text: "", zone: { controller: 1, location: 4, sequence: 0 } };
    rerender(<BattleFx events={[phase, attack, lostA, lostB]} reducedMotion={false} seats={seats} />);
    // The target breaks in the attacker's style (2 halves), the attacker in the defender's (24 tiles).
    expect(halves()).toHaveLength(26);
    expect(cutRoles().sort()).toEqual(["attacker", "target"]);
    unmount();

    const { rerender: again } = render(<BattleFx events={[phase]} reducedMotion={false} />);
    act(() => undefined);
    const damage: DuelEvent = { id: 3, kind: "damage", seat: 0, amount: 300, cause: "battle", text: "" };
    again(<BattleFx events={[phase, attack, damage]} reducedMotion={false} />);
    expect(layerPaths().length).toBeGreaterThan(0);
    expect(halves()).toHaveLength(0);
  });

  it("plays only the newest attack of a burst", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} />);
    act(() => undefined);
    const dealt: DuelEvent = { id: 5, kind: "damage", seat: 1, amount: 800, cause: "battle", text: "" };
    rerender(<BattleFx events={[phase, attack, direct, dealt]} reducedMotion={false} />);
    // The newest attack is the direct one: there is no card to cut.
    expect(playLayer()?.getAttribute("data-kind")).toBe("direct");
    expect(document.body.querySelectorAll("div[style*='clip-path']")).toHaveLength(0);
  });

  it("reads a signature attacker from the art's image URL when no view is given", () => {
    board.querySelector('[data-zones="0:4:0"] [data-card-art]')!.innerHTML = '<img src="/api/cards/89631139/image?size=small" alt="">';
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} />);
    act(() => undefined);
    rerender(<BattleFx events={[phase, attack, hurt]} reducedMotion={false} />);
    expect(playLayer()?.getAttribute("data-style")).toBe("lightning");
    // The signature's name shows at the attacker.
    expect(document.body.textContent).toContain("White Lightning");
  });

  it("picks the style from the card that attacked, using the board as it was before the snapshot", () => {
    const before = seatsOf(machine, warrior);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={before} />);
    act(() => undefined);
    // The new snapshot has already lost the destroyed target; the attack still resolves both cards.
    const after = [before[0], { ...before[1], monsters: [null] }] as unknown as DuelSeatView[];
    const destroyed: DuelEvent = { id: 3, kind: "destroy", seat: 1, text: "", zone: { controller: 1, location: 4, sequence: 0 } };
    rerender(<BattleFx events={[phase, attack, destroyed]} reducedMotion={false} seats={after} />);
    expect(playLayer()?.getAttribute("data-style")).toBe("beam");
    expect(playLayer()?.getAttribute("data-kind")).toBe("win");
    expect(halves()).toHaveLength(24);
  });

  it("falls back to the default impact style for an unknown card", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} />);
    act(() => undefined);
    rerender(<BattleFx events={[phase, attack, hurt]} reducedMotion={false} />);
    expect(playLayer()?.getAttribute("data-style")).toBe("impact");
    expect(playLayer()?.getAttribute("data-kind")).toBe("held");
  });

  it("waits for the counter strike before rolling the attacker's LP, and keeps a counter fight under the battle ceiling", () => {
    const seats = seatsOf(warrior, machine);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    act(() => undefined);
    const damage: DuelEvent = { id: 3, kind: "damage", seat: 0, amount: 500, cause: "battle", text: "" };
    const destroyed: DuelEvent = { id: 4, kind: "destroy", seat: 0, text: "", zone: { controller: 0, location: 4, sequence: 0 } };
    rerender(<BattleFx events={[phase, attack, damage, destroyed]} reducedMotion={false} seats={seats} />);
    // slash lands at 520 ms; the counter (beam, 440 ms at counter speed) starts COUNTER_GAP_MS later.
    expect(takeLpHold(0)).toBe(Math.round(520 + COUNTER_GAP_MS + 440 * COUNTER_SCALE));
    const total = Number.parseFloat((playLayer() as HTMLElement).style.getPropertyValue("--total"));
    expect(total).toBeGreaterThan(1150);
    expect(total).toBeLessThanOrEqual(MAX_BATTLE_MS);
  });

  it("keeps the losing attacker standing until the counter strike has landed", () => {
    clearBattleHolds();
    const seats = seatsOf(warrior, machine);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    act(() => undefined);
    const destroyed: DuelEvent = { id: 4, kind: "destroy", seat: 0, text: "", zone: { controller: 0, location: 4, sequence: 0 } };
    const before = performance.now();
    rerender(<BattleFx events={[phase, attack, destroyed]} reducedMotion={false} seats={seats} />);
    // slash lands at 520 ms, the counter (beam) lands at 1060 ms; the attacker breaks a beat after that
    const breakAt = battleDestroyAt({ controller: 0, location: 4, sequence: 0 }, before) - before;
    expect(breakAt).toBeGreaterThanOrEqual(Math.round(520 + 100 + 440 * 0.7) + 120 - 5);
    // the surviving defender is not held
    expect(battleDestroyAt({ controller: 1, location: 4, sequence: 0 }, before)).toBe(0);
  });

  it("holds a destroyed target until its own hit landed, and keeps the order under reduced motion", () => {
    clearBattleHolds();
    const seats = seatsOf(machine, warrior);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion seats={seats} />);
    act(() => undefined);
    const destroyed: DuelEvent = { id: 3, kind: "destroy", seat: 1, text: "", zone: { controller: 1, location: 4, sequence: 0 } };
    const before = performance.now();
    rerender(<BattleFx events={[phase, attack, destroyed]} reducedMotion seats={seats} />);
    const breakAt = battleDestroyAt({ controller: 1, location: 4, sequence: 0 }, before) - before;
    // reduced: the hit lands at 260 ms, the break is after it (460 ms), still after the flash
    expect(breakAt).toBeGreaterThan(260);
    expect(breakAt).toBeLessThan(800);
  });

  it("uses flashes and fades only under reduced motion", () => {
    const seats = seatsOf(warrior, machine);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion seats={seats} />);
    act(() => undefined);
    const destroyed: DuelEvent = { id: 3, kind: "destroy", seat: 1, text: "", zone: { controller: 1, location: 4, sequence: 0 } };
    rerender(<BattleFx events={[phase, attack, destroyed]} reducedMotion seats={seats} />);
    expect(playLayer()?.getAttribute("data-reduced")).toBe("true");
    // The target fades whole (one piece), with no bolt, beam or slash paths.
    expect(halves()).toHaveLength(1);
    expect(document.body.querySelectorAll("svg path[stroke-linecap]")).toHaveLength(0);
  });

  it("does not arm the LP hold under reduced motion", () => {
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion />);
    act(() => undefined);
    const damage: DuelEvent = { id: 3, kind: "damage", seat: 1, amount: 800, cause: "battle", text: "" };
    rerender(<BattleFx events={[phase, attack, damage]} reducedMotion />);
    expect(takeLpHold(1)).toBe(0);
  });
});

describe("BattleFx resolution", () => {
  let board: HTMLElement;
  const boxes: Record<string, DOMRect> = {
    "0:4:0": { left: 100, top: 400, width: 60, height: 88 } as DOMRect,
    "1:4:0": { left: 100, top: 100, width: 60, height: 88 } as DOMRect,
    lp0: { left: 20, top: 520, width: 200, height: 50 } as DOMRect,
    lp1: { left: 20, top: 20, width: 200, height: 50 } as DOMRect,
  };
  beforeEach(() => {
    clearLpHolds();
    clearBattleHolds();
    board = document.createElement("div");
    board.innerHTML = `
      <div data-zones="0:4:0"><div data-card-art></div></div>
      <div data-zones="1:4:0"><div data-card-art></div></div>
      <div data-lp-seat="0"><strong>8000</strong></div>
      <div data-lp-seat="1"><strong>8000</strong></div>`;
    document.body.appendChild(board);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const zone = this.closest("[data-zones]")?.getAttribute("data-zones");
      const lp = this.closest("[data-lp-seat]")?.getAttribute("data-lp-seat");
      const box = zone ? boxes[zone] : lp ? boxes[`lp${lp}`] : undefined;
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
  const activate: DuelEvent = { id: 3, kind: "activate", seat: 1, text: "activate", zone: { controller: 1, location: 5, sequence: 0 } };
  const damage = (id: number, seat: number, amount = 500): DuelEvent => ({ id, kind: "damage", seat, amount, cause: "battle", text: "" });
  const destroyed = (id: number, controller: number): DuelEvent => ({ id, kind: "destroy", seat: controller, text: "", cause: "battle", zone: { controller, location: 4, sequence: 0 } });
  const playLayer = () => document.body.querySelector("[data-style]");
  const warrior = { code: 6368038, name: "Gaia The Fierce Knight", race: "Warrior", attribute: 1 };
  const machine = { code: 77585513, name: "Jinzo", race: "Machine", attribute: 32 };
  const seats = (defenderPosition = 1): DuelSeatView[] =>
    [
      { seat: 0, monsters: [{ controller: 0, location: 4, sequence: 0, position: 1, ...warrior }] },
      { seat: 1, monsters: [{ controller: 1, location: 4, sequence: 0, position: defenderPosition, ...machine }] },
    ] as unknown as DuelSeatView[];
  const open = (view = seats()) => {
    const mounted = render(<BattleFx events={[phase]} reducedMotion={false} seats={view} />);
    act(() => undefined);
    return mounted;
  };
  const markerOf = () => document.body.querySelector("[data-aim]");

  it("only marks the attack at the declaration: no strike, no hold, no LP roll", () => {
    const { rerender } = open();
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seats()} />);
    expect(playLayer()).toBeNull();
    expect(markerOf()?.getAttribute("data-aim")).toBe("locked");
    expect(takeLpHold(1)).toBe(0);
    expect(battleDestroyAt({ controller: 1, location: 4, sequence: 0 })).toBe(0);
  });

  it("plays the whole animation when the battle resolves in a later snapshot, then drops the marker", () => {
    const { rerender } = open();
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seats()} />);
    // a response window passes with nothing used, then the damage and the destroy arrive
    const later = [phase, attack, damage(3, 1, 800), destroyed(4, 1)];
    rerender(<BattleFx events={later} reducedMotion={false} seats={seats()} />);
    expect(playLayer()?.getAttribute("data-style")).toBe("slash");
    expect(playLayer()?.getAttribute("data-kind")).toBe("win");
    expect(markerOf()).toBeNull();
    expect(takeLpHold(1)).toBeGreaterThan(0);
    expect(battleDestroyAt({ controller: 1, location: 4, sequence: 0 })).toBeGreaterThan(0);
  });

  it("still plays a fight that an ATK boost in the window did not stop", () => {
    const { rerender } = open();
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seats()} />);
    rerender(<BattleFx events={[phase, attack, activate, damage(4, 0, 500), destroyed(5, 0)]} reducedMotion={false} seats={seats()} />);
    expect(playLayer()?.getAttribute("data-kind")).toBe("lose");
    expect(playLayer()?.getAttribute("data-counter-style")).toBe("beam");
  });

  it("plays no attack animation when the attack is negated or the attacker leaves", () => {
    const { rerender, unmount } = open();
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seats()} />);
    // the window used a card, nothing was dealt and the Battle Phase ended
    const resolving: DuelEvent = { id: 4, kind: "chain-resolved", text: "" };
    const next: DuelEvent = { id: 5, kind: "phase", text: "main 2" };
    rerender(<BattleFx events={[phase, attack, activate, resolving, next]} reducedMotion={false} seats={seats()} />);
    expect(playLayer()).toBeNull();
    expect(markerOf()).toBeNull();
    expect(takeLpHold(1)).toBe(0);
    unmount();

    clearBattleHolds();
    const again = open();
    again.rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seats()} />);
    const trap: DuelEvent = { id: 4, kind: "destroy", seat: 0, text: "", cause: "effect", zone: { controller: 0, location: 4, sequence: 0 } };
    again.rerender(<BattleFx events={[phase, attack, activate, trap]} reducedMotion={false} seats={seats()} />);
    expect(playLayer()).toBeNull();
    expect(markerOf()).toBeNull();
  });

  it("does not play a fight for an attack that was already in the first snapshot", () => {
    const first = render(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seats()} />);
    act(() => undefined);
    first.rerender(<BattleFx events={[phase, attack, damage(3, 1), destroyed(4, 1)]} reducedMotion={false} seats={seats()} />);
    expect(playLayer()).toBeNull();
  });

  it("answers a tie with a counter strike, and slices both cards after it", () => {
    const { rerender } = open();
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seats()} />);
    const from = performance.now();
    rerender(<BattleFx events={[phase, attack, destroyed(3, 1), destroyed(4, 0)]} reducedMotion={false} seats={seats()} />);
    expect(playLayer()?.getAttribute("data-kind")).toBe("tie");
    expect(playLayer()?.getAttribute("data-counter-style")).toBe("beam");
    const total = Number.parseFloat((playLayer() as HTMLElement).style.getPropertyValue("--total"));
    expect(total).toBeLessThanOrEqual(MAX_BATTLE_MS);
    // both cards stay until the counter landed (impact 520, then the pause, then the beam at counter speed)
    const counterImpact = Math.round(520 + COUNTER_GAP_MS + 440 * COUNTER_SCALE);
    expect(battleDestroyAt({ controller: 0, location: 4, sequence: 0 }, from) - from).toBeGreaterThanOrEqual(counterImpact + DESTROY_BEAT_MS - 5);
    expect(battleDestroyAt({ controller: 1, location: 4, sequence: 0 }, from) - from).toBeGreaterThanOrEqual(counterImpact + DESTROY_BEAT_MS - 5);
  });

  it("bounces a blow off a stronger Defense Position monster: the counter hurts the attacker and nothing breaks", () => {
    const view = seats(4);
    const { rerender } = open(view);
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={view} />);
    rerender(<BattleFx events={[phase, attack, damage(3, 0, 700)]} reducedMotion={false} seats={view} />);
    expect(playLayer()?.getAttribute("data-kind")).toBe("bounce");
    expect(playLayer()?.getAttribute("data-counter-style")).toBe("beam");
    expect(document.body.querySelectorAll("div[style*='clip-path']")).toHaveLength(0);
    // the attacker's LP rolls when the counter lands, not at the first strike
    expect(takeLpHold(0)).toBe(Math.round(520 + COUNTER_GAP_MS + 440 * COUNTER_SCALE));
  });

  it("shows a clash when the next phase closes a fight that left no damage and no destroy", () => {
    const { rerender } = open();
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seats(4)} />);
    expect(playLayer()).toBeNull();
    rerender(<BattleFx events={[phase, attack, { id: 3, kind: "phase", text: "main 2" }]} reducedMotion={false} seats={seats(4)} />);
    expect(playLayer()?.getAttribute("data-kind")).toBe("held");
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
