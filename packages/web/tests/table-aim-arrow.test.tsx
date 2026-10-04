// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelAnswer } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { aimArrowPath } from "@/components/duel/table/aim-arrow";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureSet, TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";

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

type Answer = (answer: DuelAnswer) => void;

/** The fixture shell with the answer sent to a spy, and an optional edit of the state (a cancelable prompt). */
function Shell({ set, id, onAnswer, edit }: { set: TableFixtureSet; id: string; onAnswer: Answer; edit?: (state: TableFixtureState) => TableFixtureState }) {
  const source = (set.states as Record<string, TableFixtureState>)[id];
  const controller = useFixtureController(edit ? edit(source) : source, { reducedMotion: true });
  return <TableShell controller={{ ...controller, onAnswer }} />;
}

const move = (target: Element | Window, x = 400, y = 300) => act(() => void fireEvent.pointerMove(target, { clientX: x, clientY: y }));
const pointerClick = (target: Element) => act(() => void fireEvent.click(target, { detail: 1, button: 0 }));
const press = (key: string) => act(() => void fireEvent.keyDown(window, { key }));
const arrow = () => document.querySelector<HTMLElement>("[data-aim-arrow]");
const label = () => document.querySelector("[data-aim-label]:not([hidden])")?.textContent ?? null;
const foeMonster = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-zones][data-legal='true']")!;

describe.each([
  ["3-way", FFA3_FIXTURES],
  ["4-way", FFA4_FIXTURES],
] as const)("aim arrow on the %s table: attack target step", (_name, set) => {
  it("draws no arrow before the mouse moves, then follows the cursor", () => {
    const { container } = render(<Shell set={set} id="battle-aim" onAnswer={vi.fn()} />);
    expect(arrow()).toBeNull();
    move(container.querySelector("[data-table-stage]")!);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    expect(label()).toBeNull();
    // The arrow never takes the pointer.
    expect(arrow()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("snaps to an opposing monster under the cursor, lights it, and a click sends that card", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell set={set} id="battle-aim" onAnswer={onAnswer} />);
    const target = foeMonster(container);
    move(target);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("snapped");
    expect(label()).toMatch(/^Attack: .+/);
    expect(document.querySelector("[data-aim-hot='true']")).not.toBeNull();
    pointerClick(target.matches("button") ? target : (target.querySelector("button") ?? target));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toHaveProperty("selected");
    // A second click on the same prompt does not send again.
    pointerClick(target);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a board that holds no legal target", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell set={set} id="battle-aim" onAnswer={onAnswer} />);
    const own = container.querySelector<HTMLElement>("[data-seat-field][data-side='you']") ?? container.querySelector<HTMLElement>("[data-seat-field='0']")!;
    move(own);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    expect(document.querySelector("[data-aim-hot='true']")).toBeNull();
    pointerClick(own);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("a rival's whole board is the direct-attack target: hover snaps, a click sends that seat", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell set={set} id="direct-attack" onAnswer={onAnswer} />);
    const field = container.querySelector<HTMLElement>("[data-seat-field='1']")!;
    move(field);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("snapped");
    expect(label()).toMatch(/^Direct attack: /);
    expect(field.getAttribute("data-aim-hot")).toBe("true");
    pointerClick(field);
    expect(onAnswer).toHaveBeenCalledWith({ choice: "direct-1" });
  });

  it("the LP panel of a rival counts as its board", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell set={set} id="direct-attack" onAnswer={onAnswer} />);
    const lp = container.querySelector<HTMLElement>("[data-lp-seat='1']")!;
    move(lp);
    expect(label()).toMatch(/^Direct attack: /);
    pointerClick(lp);
    expect(onAnswer).toHaveBeenCalledWith({ choice: "direct-1" });
  });

  it("your own board is not a direct-attack target", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell set={set} id="direct-attack" onAnswer={onAnswer} />);
    const own = container.querySelector<HTMLElement>("[data-seat-field='0']")!;
    move(own);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    pointerClick(own);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("a keyboard click (no pointer) keeps the lock-then-confirm flow", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell set={set} id="battle-aim" onAnswer={onAnswer} />);
    const target = foeMonster(container);
    act(() => void fireEvent.click(target.matches("button") ? target : (target.querySelector("button") ?? target)));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(container.querySelector("[data-attack-line]")?.getAttribute("data-attack-line")).toBe("locked");
  });

  it("number keys and Enter still pick a seat for a direct attack", () => {
    const onAnswer = vi.fn();
    render(<Shell set={set} id="direct-attack" onAnswer={onAnswer} />);
    press("1");
    expect(onAnswer).not.toHaveBeenCalled();
    press("Enter");
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toHaveProperty("choice");
  });

  it("Esc cancels the aim when the prompt can be cancelled", () => {
    const onAnswer = vi.fn();
    render(
      <Shell
        set={set}
        id="battle-aim"
        onAnswer={onAnswer}
        edit={(state) => ({ ...state, room: { ...state.room, engine: { ...state.room.engine!, prompt: { ...state.room.engine!.prompt!, cancelable: true } } } })}
      />,
    );
    press("Escape");
    expect(onAnswer).toHaveBeenCalledWith({ cancel: true });
  });

  it("the arrow goes away when the mouse leaves for a touch tap", () => {
    const { container } = render(<Shell set={set} id="battle-aim" onAnswer={vi.fn()} />);
    move(container.querySelector("[data-table-stage]")!);
    expect(arrow()).not.toBeNull();
    act(() => void fireEvent.pointerMove(window, { pointerType: "touch", clientX: 5, clientY: 5 }));
    expect(arrow()).toBeNull();
  });
});

describe("aim arrow on the 3-way table: a seat with no direct option", () => {
  it("is not a target: no snap, and a click does nothing", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell set={FFA3_FIXTURES} id="direct-attack" onAnswer={onAnswer} />);
    const field = container.querySelector<HTMLElement>("[data-seat-field='2']")!;
    move(field);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    expect(field.hasAttribute("data-aim-hot")).toBe(false);
    pointerClick(field);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe("aim arrow pieces", () => {
  it("aimArrowPath starts and ends on its points", () => {
    const path = aimArrowPath({ x: 100, y: 700 }, { x: 300, y: 100 });
    expect(path.startsWith("M100 700 Q")).toBe(true);
    expect(path.endsWith("300 100")).toBe(true);
  });
});

describe("choose the attacker, then the target, as one gesture", () => {
  const MZONE = 4;
  const attacker = "0:4:0";

  /** Step 0: the battle action prompt with one attack option. Step 1: the duelist pick, as the engine sends it after. */
  function TwoStep({ set, onAnswer }: { set: TableFixtureSet; onAnswer: Answer }) {
    const [step, setStep] = React.useState<0 | 1>(0);
    const base = (set.states as Record<string, TableFixtureState>)["direct-attack"];
    const prompt =
      step === 0
        ? ({
            id: "attack-action",
            seat: 0,
            kind: "choice",
            title: "Battle",
            context: { type: "action", phase: "battle" },
            options: [{ id: "attack:0", label: "Attack directly", controller: 0, location: MZONE, sequence: 0 }],
          } as const)
        : base.room.engine!.prompt!;
    const state = { ...base, ui: undefined, room: { ...base.room, engine: { ...base.room.engine!, prompt: { ...prompt } } } } as unknown as TableFixtureState;
    const controller = useFixtureController(state, { reducedMotion: true });
    return (
      <TableShell
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

  it.each([
    ["3-way", FFA3_FIXTURES],
    ["4-way", FFA4_FIXTURES],
  ] as const)("a click on a monster that can only attack declares it, then the arrow aims from it (%s)", (_name, set) => {
    const onAnswer = vi.fn();
    const { container } = render(<TwoStep set={set} onAnswer={onAnswer} />);
    const monster = container.querySelector<HTMLElement>(`[data-zones~="${attacker}"]`)!;
    pointerClick(monster.matches("button") ? monster : (monster.querySelector("button") ?? monster));
    expect(onAnswer).toHaveBeenCalledWith({ choice: "attack:0" });
    expect(document.querySelector("[data-card-menu]")).toBeNull();
    // The duelist prompt came: the attacker stays declared, so the arrow runs from it to the cursor.
    move(container.querySelector("[data-table-stage]")!);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    const field = container.querySelector<HTMLElement>("[data-seat-field='1']")!;
    move(field);
    expect(label()).toMatch(/^Direct attack: /);
    pointerClick(field);
    expect(onAnswer).toHaveBeenLastCalledWith({ choice: "direct-1" });
  });
});
