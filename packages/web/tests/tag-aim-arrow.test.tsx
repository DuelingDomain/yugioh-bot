// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelAnswer } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { TagShell } from "@/components/duel/tag/tag-shell";

// Seats of the Tag fixtures: Aster (you, 0) and Corvin (2) are a team, Mirelle (1) and Juniper (3) the rivals.
const ME = 0;
const PARTNER = 2;
const OPEN_RIVAL = 3;
const BUSY_RIVAL = 1;

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(cleanup);

function Shell({ id, onAnswer, cancelable }: { id: "direct-attack" | "battle-aim"; onAnswer: (answer: DuelAnswer) => void; cancelable?: boolean }) {
  const fixture = (TAG_FIXTURES.states as Record<string, TableFixtureState>)[id];
  const source = cancelable
    ? ({ ...fixture, room: { ...fixture.room, engine: { ...fixture.room.engine!, prompt: { ...fixture.room.engine!.prompt!, cancelable: true } } } } as TableFixtureState)
    : fixture;
  const controller = useFixtureController(source, { reducedMotion: true });
  return <TagShell controller={{ ...controller, onAnswer }} />;
}

const move = (target: Element | Window, x = 400, y = 300) => act(() => void fireEvent.pointerMove(target, { clientX: x, clientY: y }));
const pointerClick = (target: Element) => act(() => void fireEvent.click(target, { detail: 1, button: 0 }));
const arrow = () => document.querySelector<HTMLElement>("[data-aim-arrow]");
const label = () => document.querySelector("[data-aim-label]:not([hidden])")?.textContent ?? null;
const lpChip = (container: HTMLElement, seat: number) => container.querySelector<HTMLElement>(`[data-lp-seat='${seat}']`)!;
const board = (container: HTMLElement, seat: number) => container.querySelector<HTMLElement>(`[data-zones~='${seat}:4:0']`)!;

describe("aim arrow on the Tag table: a direct attack", () => {
  it("the open rival is the target: hover snaps, one click sends its seat", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell id="direct-attack" onAnswer={onAnswer} />);
    const chip = lpChip(container, OPEN_RIVAL);
    move(chip);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("snapped");
    expect(label()).toMatch(/^Direct attack: /);
    pointerClick(chip);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ choice: `direct-${OPEN_RIVAL}` });
    // A second click on the same prompt does not send again.
    pointerClick(chip);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("your partner's board and LP chip send nothing", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell id="direct-attack" onAnswer={onAnswer} />);
    expect(lpChip(container, PARTNER)).toBeTruthy();
    expect(board(container, PARTNER)).toBeTruthy();
    for (const node of [lpChip(container, PARTNER), board(container, PARTNER)]) {
      move(node);
      expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
      expect(label()).toBeNull();
      pointerClick(node);
    }
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("your own seat sends nothing", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell id="direct-attack" onAnswer={onAnswer} />);
    expect(lpChip(container, ME)).toBeTruthy();
    expect(board(container, ME)).toBeTruthy();
    for (const node of [lpChip(container, ME), board(container, ME)]) {
      move(node);
      expect(label()).toBeNull();
      pointerClick(node);
    }
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("a rival with no direct option (it still has monsters) sends nothing", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell id="direct-attack" onAnswer={onAnswer} />);
    expect(lpChip(container, BUSY_RIVAL)).toBeTruthy();
    expect(board(container, BUSY_RIVAL)).toBeTruthy();
    for (const node of [lpChip(container, BUSY_RIVAL), board(container, BUSY_RIVAL)]) {
      move(node);
      expect(label()).toBeNull();
      pointerClick(node);
    }
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("a finger aims with the first tap and sends with the second", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell id="direct-attack" onAnswer={onAnswer} />);
    const chip = lpChip(container, OPEN_RIVAL);
    act(() => void fireEvent.pointerDown(chip, { pointerType: "touch" }));
    pointerClick(chip);
    expect(onAnswer).not.toHaveBeenCalled();
    expect(label()).toMatch(/^Direct attack: /);
    act(() => void fireEvent.pointerDown(chip, { pointerType: "touch" }));
    pointerClick(chip);
    expect(onAnswer).toHaveBeenCalledWith({ choice: `direct-${OPEN_RIVAL}` });
  });

  it("tells the player to click, with the Esc way out only when the pick can be cancelled", () => {
    const { container } = render(<Shell id="battle-aim" onAnswer={vi.fn()} />);
    expect(container.textContent).toContain("Click a target to attack.");
    expect(container.textContent).not.toContain("Esc to cancel");
    expect(container.textContent).not.toContain("Point at a target");
    cleanup();
    const cancelable = render(<Shell id="battle-aim" onAnswer={vi.fn()} cancelable />);
    expect(cancelable.container.textContent).toContain("Click a target to attack. Esc to cancel.");
  });
});

describe("aim arrow on the Tag table: an attack target", () => {
  it("a rival monster under the cursor snaps, and one click sends it once", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell id="battle-aim" onAnswer={onAnswer} />);
    const target = container.querySelector<HTMLElement>("[data-zones][data-legal='true']")!;
    move(target);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("snapped");
    expect(label()).toMatch(/^Attack: .+/);
    pointerClick(target.matches("button") ? target : (target.querySelector("button") ?? target));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toHaveProperty("selected");
    pointerClick(target);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("your partner's monster is no target", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell id="battle-aim" onAnswer={onAnswer} />);
    const partner = board(container, PARTNER);
    expect(partner).toBeTruthy();
    move(partner);
    expect(label()).toBeNull();
    pointerClick(partner);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe("aim arrow on the Tag table: the card menu draws no aim", () => {
  const MZONE = 4;
  const attackLine = () => document.querySelector("[data-attack-line]")?.getAttribute("data-attack-line") ?? "off";

  /** Step 0: a monster with Activate and Attack in its menu. Step 1: the attack target pick the engine sends after Attack. */
  function Menu({ onAnswer, attackLabel = "Attack with Blue-Eyes Spirit Dragon" }: { onAnswer: (answer: DuelAnswer) => void; attackLabel?: string }) {
    const [step, setStep] = React.useState<0 | 1>(0);
    const base = (TAG_FIXTURES.states as Record<string, TableFixtureState>)["battle-aim"];
    const prompt =
      step === 0
        ? ({
            id: "attack-action",
            seat: ME,
            kind: "choice",
            title: "Battle",
            context: { type: "action", phase: "battle" },
            options: [
              { id: "act:0", label: "Activate \u2014 Special Summon", controller: ME, location: MZONE, sequence: 0 },
              { id: "attack:0", label: attackLabel, controller: ME, location: MZONE, sequence: 0 },
            ],
          } as const)
        : base.room.engine!.prompt!;
    const state = { ...base, ui: undefined, room: { ...base.room, engine: { ...base.room.engine!, prompt: { ...prompt } } } } as unknown as TableFixtureState;
    const controller = useFixtureController(state, { reducedMotion: true });
    return (
      <TagShell
        controller={{
          ...controller,
          onAnswer: (answer) => {
            onAnswer(answer);
            if (answer.choice === "attack:0") setStep(1);
          },
        }}
      />
    );
  }

  const openMenu = (container: HTMLElement) => {
    const monster = board(container, ME);
    pointerClick(monster.matches("button") ? monster : (monster.querySelector<HTMLElement>("button") ?? monster));
    const items = Array.from(document.querySelectorAll<HTMLElement>("[role='menu'] [role='menuitem']"));
    return items.find((item) => /^Attack/.test(item.textContent?.trim() ?? ""))!;
  };

  it.each([
    ["a monster target", "Attack with Blue-Eyes Spirit Dragon"],
    ["a direct attack", "Attack directly with Blue-Eyes Spirit Dragon"],
  ])("no arrow and no target mark while the menu is open, on hover or focus of Attack (%s)", (_name, attackLabel) => {
    const onAnswer = vi.fn();
    const { container } = render(<Menu onAnswer={onAnswer} attackLabel={attackLabel} />);
    const attack = openMenu(container);
    expect(attack).toBeTruthy();
    const stage = () => container.querySelector("[data-battle]")?.getAttribute("data-battle");
    const marked = () => container.querySelector("[data-locked='true']");
    const before = stage();
    expect(marked()).toBeNull();
    act(() => void fireEvent.mouseEnter(attack));
    act(() => void fireEvent.focus(attack));
    expect(attackLine()).toBe("off");
    expect(arrow()).toBeNull();
    expect(marked()).toBeNull();
    expect(stage()).toBe(before);
    expect(document.querySelector("[data-aim-hot='true']")).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("Attack starts the aim with no target until the player aims, and sends nothing until a target is clicked", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Menu onAnswer={onAnswer} />);
    const attack = openMenu(container);
    act(() => void fireEvent.click(attack));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(arrow()).toBeNull();
    expect(document.querySelector("[data-aim-hot='true']")).toBeNull();
    move(container.querySelector("[data-table-stage]")!);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    expect(label()).toBeNull();
    expect(document.querySelector("[data-aim-hot='true']")).toBeNull();
    const target = container.querySelector<HTMLElement>("[data-zones][data-legal='true']")!;
    move(target);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("snapped");
    expect(label()).toMatch(/^Attack: /);
    expect(onAnswer).not.toHaveBeenCalled();
    pointerClick(target.matches("button") ? target : (target.querySelector("button") ?? target));
    expect(onAnswer).toHaveBeenCalledWith({ choice: "attack:0" });
  });

  it("Esc ends the aim and sends nothing", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Menu onAnswer={onAnswer} />);
    const attack = openMenu(container);
    act(() => void fireEvent.click(attack));
    move(container.querySelector("[data-table-stage]")!);
    expect(arrow()).not.toBeNull();
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(arrow()).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
