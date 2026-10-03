// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { DuelEvent, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { COUNTER_GAP_MS, COUNTER_SCALE, DESTROY_BEAT_MS, MAX_BATTLE_MS, STYLE_TIMING } from "@/components/duel/attack-styles";
import { ATTACK_TIMING, LP_TIMING } from "@/components/duel/duel-timing";
import { BattleFx } from "@/components/duel/battle-fx";
import { battleDestroyAt, clearBattleHolds } from "@/components/duel/battle-hold";
import { AttackConfirm } from "@/components/duel/card-interactions";
import { armLpHold, clearLpHolds, takeLpHold } from "@/components/duel/life-points";
import { isAttackTargetPrompt, isDirectAttackPrompt } from "@/components/duel/prompts";
import { setSharedFx3d } from "@/components/duel/fx3d/shared";
import { clearPromptRevealHold, promptRevealHoldMs } from "@/components/duel/prompt-reveal";
import { DUEL_FX_CUE_EVENT, type DuelFxCueDetail } from "@/components/duel/event-queue";
import type { FxRequest } from "@/components/duel/fx3d/types";

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
    vi.advanceTimersByTime(LP_TIMING.holdExpiryMs + 500);
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
    attacker: { code?: number; name?: string; race?: string; attribute?: number; attack?: number; defense?: number },
    defender: { code?: number; name?: string; race?: string; attribute?: number; attack?: number; defense?: number },
    defenderPosition = 1,
  ): DuelSeatView[] =>
    [
      { seat: 0, monsters: [{ controller: 0, location: 4, sequence: 0, position: 1, ...attacker }] },
      { seat: 1, monsters: [{ controller: 1, location: 4, sequence: 0, position: defenderPosition, ...defender }] },
    ] as unknown as DuelSeatView[];
  // A Warrior (slash: two halves), a Machine (beam: 24 tiles) and a Spellcaster (arcane: 24 tiles).
  const warrior = { code: 6368038, name: "Gaia The Fierce Knight", race: "Warrior", attribute: 1, attack: 2300, defense: 2100 };
  const machine = { code: 77585513, name: "Jinzo", race: "Machine", attribute: 32, attack: 2400, defense: 1500 };

  it.each([0, 1, null])("uses the changed defender pose for DOM and canvas playback for viewer %s", viewer => {
    const node = board.querySelector<HTMLElement>('[data-zones="1:4:0"]')!;
    node.dataset.side = viewer === 1 ? "you" : "opp";
    node.dataset.defense = "false";
    node.querySelector<HTMLElement>("[data-card-art]")!.dataset.defense = "false";
    const position: DuelEvent = { id: 2, kind: "position", text: "Enemy Controller", zone: attack.target,
      card: machine as DuelEvent["card"], fromPosition: 1, toPosition: 4 };
    const declaration = { ...attack, id: 3 };
    const calculation: DuelEvent = { id: 4, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 2300, defense: 2100, position: 1 }, target: { attack: 2400, defense: 1500, position: 4 } } };
    const destroyed: DuelEvent = { id: 5, kind: "destroy", text: "Destroyed in defense", zone: attack.target, cause: "battle", fromPosition: 4 };
    for (const canvas of [false, true]) {
      const play = vi.fn((_id: string, _request: FxRequest) => Promise.resolve());
      if (canvas) setSharedFx3d({ host: board, api: { ready: true, play, prefetchArt() {}, cancelAll() {} } });
      try {
        const { rerender, unmount } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seatsOf(warrior, machine)} />);
        // Position change and declaration arrive together: the DOM still has the pre-change pose.
        rerender(<BattleFx events={[phase, position, declaration]} reducedMotion={false} seats={seatsOf(warrior, machine, 4)} />);
        const after = seatsOf(warrior, machine, 4);
        after[1].monsters[0] = null;
        rerender(<BattleFx events={[phase, position, declaration, calculation, destroyed]} reducedMotion={false} seats={after} />);
        if (canvas) {
          expect(play.mock.calls[0]?.[1].battle?.breaks[0]).toMatchObject({ defense: true, turned: viewer !== 1, rect: { w: 88, h: 60 } });
        } else {
          const art = document.querySelector('[data-role="target"] [data-card-art]');
          expect(art?.getAttribute("data-defense")).toBe("true");
          expect(art?.getAttribute("data-turned")).toBe(viewer === 1 ? null : "true");
        }
        unmount();
      } finally { setSharedFx3d(null); }
    }
  });

  it("refreshes declaration-time art from the engine calculation position", () => {
    const node = board.querySelector<HTMLElement>('[data-zones="1:4:0"]')!;
    node.dataset.defense = "false";
    node.querySelector<HTMLElement>("[data-card-art]")!.dataset.defense = "false";
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seatsOf(warrior, machine)} />);
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seatsOf(warrior, machine)} />);
    const calculation: DuelEvent = { id: 3, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 2300, defense: 2100, position: 1 }, target: { attack: 2400, defense: 1500, position: 4 } } };
    const destroy: DuelEvent = { id: 4, kind: "destroy", text: "", zone: attack.target, fromPosition: 4, cause: "battle" };
    rerender(<BattleFx events={[phase, attack, calculation, destroy]} reducedMotion={false} seats={seatsOf(warrior, machine, 4)} />);
    expect(document.querySelector('[data-role="target"] [data-card-art]')?.getAttribute("data-defense")).toBe("true");
  });

  it("omits calculation plates when both battlers keep their board stats", () => {
    const before = seatsOf({ ...warrior, attack: 2300, defense: 2100 }, { ...machine, attack: 2400, defense: 1500 }, 4);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion seats={before} />);
    const calculation: DuelEvent = { id: 3, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 2300, defense: 2100, position: 1 }, target: { attack: 2400, defense: 1500, position: 4 } } };
    rerender(<BattleFx events={[phase, attack, calculation, { id: 4, kind: "battle-end", text: "End" }]} reducedMotion seats={before} />);
    expect(playLayer()).not.toBeNull();
    expect(document.querySelector('[data-battle-stat]')).toBeNull();
  });

  it("omits a plate when a response changes stats that remain on the live board", () => {
    const before = seatsOf(warrior, { ...machine, attack: 200, defense: 100 });
    const after = seatsOf({ ...warrior, attack: 3300 }, { ...machine, attack: 200, defense: 100 });
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion seats={before} />);
    rerender(<BattleFx events={[phase, attack]} reducedMotion seats={before} />);
    const calculation: DuelEvent = { id: 3, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 3300, defense: 2100, position: 1 }, target: { attack: 200, defense: 100, position: 1 } } };
    rerender(<BattleFx events={[phase, attack, calculation, { id: 4, kind: "battle-end", text: "End" }]} reducedMotion seats={after} />);
    expect(playLayer()).not.toBeNull();
    expect(document.querySelector('[data-battle-stat]')).toBeNull();
  });

  it.each(["inactive", "ended"])("clears calculation plates when the duel becomes %s mid-Damage-Step", state => {
    const before = seatsOf({ ...warrior, attack: 2300 }, machine);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion seats={before} />);
    const calculation: DuelEvent = { id: 3, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 200, defense: 2100, position: 1 }, target: { attack: 2400, defense: 1500, position: 1 } } };
    const events = [phase, attack, calculation, { id: 4, kind: "destroy", text: "", zone: attack.target, cause: "battle" } as DuelEvent];
    rerender(<BattleFx events={events} reducedMotion seats={before} />);
    expect(document.querySelector('[data-battle-stat="attacker"]')).not.toBeNull();
    rerender(<BattleFx events={events} reducedMotion seats={before} active={state !== "inactive"}
      result={state === "ended" ? { winnerSeat: 0, reason: "Surrender during the Damage Step" } : null} />);
    expect(document.querySelector('[data-battle-stat]')).toBeNull();
  });

  it("reveals and destroys a previously hidden defender in defense when its flip and departure arrive together", () => {
    const node = board.querySelector<HTMLElement>('[data-zones="1:4:0"]')!;
    node.dataset.defense = "true";
    const hidden = seatsOf(warrior, {}, 8);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={hidden} />);
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={hidden} />);
    const flip: DuelEvent = { id: 3, kind: "position", text: "Flip", zone: attack.target, fromPosition: 8, toPosition: 4,
      flip: true, card: machine as DuelEvent["card"] };
    const calculation: DuelEvent = { id: 4, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 2300, defense: 2100, position: 1 }, target: { attack: 2400, defense: 1500, position: 4 } } };
    const after = seatsOf(warrior, machine);
    after[1].monsters[0] = null;
    rerender(<BattleFx events={[phase, attack, flip, calculation,
      { id: 5, kind: "destroy", text: "", zone: attack.target, cause: "battle", fromPosition: 4 }]} reducedMotion={false} seats={after} />);
    const art = document.querySelector('[data-role="target"] [data-card-art]');
    expect(art?.getAttribute("data-defense")).toBe("true");
    expect(art?.querySelector("img")?.getAttribute("src")).toContain(`/cards/${machine.code}/image`);
  });

  it("uses the revealed defender's counter timing for the LP hold as well as playback", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    board.insertAdjacentHTML("beforeend", '<div data-lp-seat="0"><strong>8000</strong></div>');
    const hidden = seatsOf(warrior, {}, 8);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={hidden} />);
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={hidden} />);
    const flip: DuelEvent = { id: 3, kind: "position", text: "Flip", zone: attack.target, fromPosition: 8, toPosition: 4,
      flip: true, card: machine as DuelEvent["card"] };
    const calculation: DuelEvent = { id: 4, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 1000, defense: 2100, position: 1 }, target: { attack: 2400, defense: 1500, position: 4 } } };
    rerender(<BattleFx events={[phase, attack, flip, calculation,
      { id: 5, kind: "damage", seat: 0, amount: 500, cause: "battle", text: "Battle damage" }]} reducedMotion={false} seats={seatsOf(warrior, machine, 4)} />);
    expect(playLayer()?.getAttribute("data-counter-style")).toBe("beam");
    const counterHit = Math.round(STYLE_TIMING.slash.impact + COUNTER_GAP_MS + STYLE_TIMING.beam.impact * COUNTER_SCALE);
    expect(takeLpHold(0)).toBe(counterHit + ATTACK_TIMING.lpAfterHitMs);
  });

  it("retains the casualty's identity when its zone is reoccupied in the resolution snapshot", () => {
    const play = vi.fn((_id: string, _request: FxRequest) => Promise.resolve());
    setSharedFx3d({ host: board, api: { ready: true, play, prefetchArt() {}, cancelAll() {} } });
    try {
      const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seatsOf(warrior, machine, 4)} />);
      const calculation: DuelEvent = { id: 3, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
        battle: { attacker: { attack: 2300, defense: 2100, position: 1 }, target: { attack: 2400, defense: 1500, position: 4 } } };
      rerender(<BattleFx events={[phase, attack, calculation,
        { id: 4, kind: "destroy", text: "", zone: attack.target, cause: "battle", fromPosition: 4 }]} reducedMotion={false} seats={seatsOf(warrior, warrior)} />);
      expect(play.mock.calls[0]?.[1].battle?.breaks[0]).toMatchObject({ code: machine.code, defense: true });
      expect(document.querySelector('[data-battle-stat="target"]')).toBeNull();
    } finally { setSharedFx3d(null); }
  });

  it("compares a casualty to its saved stats even if a same-code replacement occupies its zone", () => {
    const before = seatsOf(warrior, { ...machine, attack: 3300 }, 4);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion seats={before} />);
    const calculation: DuelEvent = { id: 3, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 2300, defense: 2100, position: 1 }, target: { attack: 3300, defense: 1500, position: 4 } } };
    rerender(<BattleFx events={[phase, attack, calculation,
      { id: 4, kind: "destroy", text: "", zone: attack.target, cause: "battle", fromPosition: 4 }]} reducedMotion seats={seatsOf(warrior, machine)} />);
    expect(playLayer()).not.toBeNull();
    expect(document.querySelector('[data-battle-stat="target"]')).toBeNull();
  });

  it("waits through an after-calculation prompt and plays both actual battle casualties", () => {
    const before = seatsOf(warrior, machine);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={before} />);
    const calculation: DuelEvent = { id: 3, kind: "battle", text: "Damage calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 200, defense: 1200, position: 1 }, target: { attack: 200, defense: 100, position: 1 } } };
    rerender(<BattleFx events={[phase, attack, calculation]} reducedMotion={false} seats={before} />);
    expect(playLayer()).toBeNull();
    const move: DuelEvent = { id: 4, kind: "move", text: "", from: attack.zone, zone: { controller: 0, location: 16, sequence: 0 }, reason: "destroy", cause: "battle" };
    const casualties: DuelEvent[] = [move,
      { id: 5, kind: "destroy", text: "", zone: attack.zone, cause: "battle" },
      { id: 6, kind: "destroy", text: "", zone: attack.target, cause: "battle" },
      { id: 7, kind: "battle-end", text: "Damage Step ended" }];
    rerender(<BattleFx events={[phase, attack, calculation, ...casualties]} reducedMotion={false} seats={before} />);
    expect(playLayer()?.getAttribute("data-kind")).toBe("tie");
    expect(cutRoles().sort()).toEqual(["attacker", "target"]);
    expect(document.querySelector('[data-battle-stat="attacker"]')?.textContent).toBe("200 ATK");
  });

  it("shows calculation-time ATK after temporary stats have expired on the board", () => {
    vi.useFakeTimers();
    const before = seatsOf({ ...warrior, attack: 2900 }, { ...machine, attack: 200, defense: 100 });
    const { rerender, unmount } = render(<BattleFx events={[phase]} reducedMotion={false} seats={before} />);
    act(() => undefined);
    // Declaration and resolution are separate snapshots; the live attacker is back at 2900.
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={before} />);
    const calculation: DuelEvent = {
      id: 3, kind: "battle", text: "Damage calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 1200, defense: 1200, position: 1 }, target: { attack: 200, defense: 100, position: 1 } },
    };
    const damage: DuelEvent = { id: 4, kind: "damage", seat: 1, amount: 1000, cause: "battle", text: "" };
    rerender(<BattleFx events={[phase, attack, calculation, damage]} reducedMotion={false} seats={before} />);
    expect(document.querySelector('[data-battle-stat="attacker"]')?.textContent).toBe("1200 ATK");
    expect(document.querySelector('[data-battle-stat="target"]')).toBeNull();
    act(() => vi.advanceTimersByTime(10000));
    expect(document.querySelector('[data-battle-stat]')).toBeNull();
    unmount();
    vi.useRealTimers();
  });

  it("compares against board stats before a batched declaration and calculation prompt", () => {
    const before = seatsOf({ ...warrior, attack: 2900 }, { ...machine, attack: 200, defense: 100 });
    const queried = seatsOf({ ...warrior, attack: 1200 }, { ...machine, attack: 200, defense: 100 });
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion seats={before} />);
    const calculation: DuelEvent = { id: 3, kind: "battle", text: "Calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 1200, defense: 2100, position: 1 }, target: { attack: 200, defense: 100, position: 1 } } };
    rerender(<BattleFx events={[phase, attack, calculation]} reducedMotion seats={queried} />);
    expect(playLayer()).toBeNull();
    rerender(<BattleFx events={[phase, attack, calculation, { id: 4, kind: "battle-end", text: "End" }]} reducedMotion seats={before} />);
    expect(document.querySelector('[data-battle-stat="attacker"]')?.textContent).toBe("1200 ATK");
    expect(document.querySelector('[data-battle-stat="target"]')).toBeNull();
  });

  it("shows the target's calculated DEF when it is in defense, including reduced motion", () => {
    const before = seatsOf(warrior, machine, 4);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion seats={before} />);
    act(() => undefined);
    const calculation: DuelEvent = {
      id: 3, kind: "battle", text: "Damage calculation", zone: attack.zone, target: attack.target,
      battle: { attacker: { attack: 200, defense: 1200, position: 1 }, target: { attack: 200, defense: 100, position: 4 } },
    };
    const destroyed: DuelEvent = { id: 4, kind: "destroy", text: "", zone: attack.target, cause: "battle" };
    rerender(<BattleFx events={[phase, attack, calculation, destroyed]} reducedMotion seats={before} />);
    expect(document.querySelector('[data-battle-stat="attacker"]')?.textContent).toBe("200 ATK");
    expect(document.querySelector('[data-battle-stat="target"]')?.textContent).toBe("100 DEF");
    const plate = document.querySelector('[data-battle-stat="target"]') as HTMLElement;
    expect(plate.querySelector("strong")?.textContent).toBe("100");
    expect(plate.querySelector("small")?.textContent).toBe("DEF");
    expect(plate.dataset.edge).toBe("top");
    expect(plate.style.top).toContain("var(--fx-unit)");
  });

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
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const seats = seatsOf(warrior, machine);
    const { rerender } = render(<BattleFx events={[phase]} reducedMotion={false} seats={seats} />);
    act(() => undefined);
    const damage: DuelEvent = { id: 3, kind: "damage", seat: 0, amount: 500, cause: "battle", text: "" };
    const destroyed: DuelEvent = { id: 4, kind: "destroy", seat: 0, text: "", zone: { controller: 0, location: 4, sequence: 0 } };
    rerender(<BattleFx events={[phase, attack, damage, destroyed]} reducedMotion={false} seats={seats} />);
    // the slash lands first; the counter (beam, at counter speed) starts COUNTER_GAP_MS later; the roll waits a beat after that hit.
    expect(takeLpHold(0)).toBe(Math.round(STYLE_TIMING.slash.impact + COUNTER_GAP_MS + STYLE_TIMING.beam.impact * COUNTER_SCALE) + ATTACK_TIMING.lpAfterHitMs);
    const total = Number.parseFloat((playLayer() as HTMLElement).style.getPropertyValue("--total"));
    expect(total).toBeGreaterThan(1700);
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
    // reduced: the hit lands first, the break is after it, still after the flash (the holds stay, the motion is only fades)
    expect(breakAt).toBeGreaterThan(ATTACK_TIMING.reducedImpactMs);
    expect(breakAt).toBeLessThan(1000);
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
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const view = seats(4);
    const { rerender } = open(view);
    rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={view} />);
    rerender(<BattleFx events={[phase, attack, damage(3, 0, 700)]} reducedMotion={false} seats={view} />);
    expect(playLayer()?.getAttribute("data-kind")).toBe("bounce");
    expect(playLayer()?.getAttribute("data-counter-style")).toBe("beam");
    expect(document.body.querySelectorAll("div[style*='clip-path']")).toHaveLength(0);
    // the attacker's LP rolls when the counter lands, not at the first strike
    expect(takeLpHold(0)).toBe(Math.round(STYLE_TIMING.slash.impact + COUNTER_GAP_MS + STYLE_TIMING.beam.impact * COUNTER_SCALE) + ATTACK_TIMING.lpAfterHitMs);
  });

  it("keeps the canvas, DOM, sound, destruction and prompt deadline together after slow GPU preparation", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(Date, "now").mockReturnValue(10000);
    const cues: DuelFxCueDetail[] = [];
    const listen = (event: Event) => cues.push((event as CustomEvent<DuelFxCueDetail>).detail);
    window.addEventListener(DUEL_FX_CUE_EVENT, listen);
    const play = vi.fn((_id: string, request: FxRequest) => {
      now += 200;
      // The engine publishes its capped origin after constructing the effect.
      if (request.clock) request.clock.startedAt = now - 120;
      return Promise.resolve();
    });
    const prefetchArt = vi.fn();
    setSharedFx3d({ host: board, api: { ready: true, play, prefetchArt, cancelAll() {} } });
    clearPromptRevealHold();
    try {
      const { rerender, unmount } = open();
      rerender(<BattleFx events={[phase, attack]} reducedMotion={false} seats={seats()} />);
      expect(prefetchArt).toHaveBeenCalledWith(warrior.code, true);
      expect(prefetchArt).toHaveBeenCalledWith(machine.code, true);
      const resolved = [phase, attack, damage(3, 0), destroyed(4, 0)];
      rerender(<BattleFx events={resolved} reducedMotion={false} seats={seats()} />);
      const request = play.mock.calls[0]![1];
      expect(request.startedAt).toBe(1000);
      expect(cues.find((cue) => cue.cue === "battle")?.battle?.startedAt).toBe(1080);
      expect((playLayer() as HTMLElement).style.animationDelay).toBe("-120ms");
      expect(promptRevealHoldMs()).toBe(request.battle!.totalMs - 120);
      const counterHit = Math.round(STYLE_TIMING.slash.impact + COUNTER_GAP_MS + STYLE_TIMING.beam.impact * COUNTER_SCALE);
      expect(battleDestroyAt({ controller: 0, location: 4, sequence: 0 }, now)).toBe(1080 + counterHit + DESTROY_BEAT_MS);
      expect(takeLpHold(0)).toBe(counterHit + ATTACK_TIMING.lpAfterHitMs - 120);
      now += 300;
      rerender(<BattleFx events={resolved} reducedMotion={false} seats={seats()} />);
      expect((playLayer() as HTMLElement).style.animationDelay).toBe("-120ms");
      expect(play).toHaveBeenCalledOnce();
      unmount();
    } finally {
      window.removeEventListener(DUEL_FX_CUE_EVENT, listen);
      setSharedFx3d(null);
      clearPromptRevealHold();
    }
  });

  it("does not prefetch attack art under reduced motion", () => {
    const prefetchArt = vi.fn();
    const play = vi.fn(() => Promise.resolve());
    setSharedFx3d({ host: board, api: { ready: true, play, prefetchArt, cancelAll() {} } });
    try {
      const { rerender } = open();
      rerender(<BattleFx events={[phase, attack]} reducedMotion seats={seats()} />);
      rerender(<BattleFx events={[phase, attack, damage(3, 0), destroyed(4, 0)]} reducedMotion seats={seats()} />);
      expect(prefetchArt).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
    } finally { setSharedFx3d(null); }
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
