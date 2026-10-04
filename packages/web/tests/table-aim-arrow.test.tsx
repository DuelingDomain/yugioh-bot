// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelAnswer } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { AimArrow, aimArrowPath } from "@/components/duel/table/aim-arrow";
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

  /** Step 0: the battle action prompt with one attack option. Step 1: the prompt the engine sends after it. */
  function TwoStep({ set, onAnswer, label: optionLabel, next }: { set: TableFixtureSet; onAnswer: Answer; label: string; next: string }) {
    const [step, setStep] = React.useState<0 | 1>(0);
    const base = (set.states as Record<string, TableFixtureState>)[next];
    const prompt =
      step === 0
        ? ({
            id: "attack-action",
            seat: 0,
            kind: "choice",
            title: "Battle",
            context: { type: "action", phase: "battle" },
            options: [{ id: "attack:0", label: optionLabel, controller: 0, location: MZONE, sequence: 0 }],
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

  const attackerButton = (container: HTMLElement) => {
    const monster = container.querySelector<HTMLElement>(`[data-zones~="${attacker}"]`)!;
    return monster.matches("button") ? monster : (monster.querySelector<HTMLElement>("button") ?? monster);
  };

  it.each([
    ["3-way", FFA3_FIXTURES],
    ["4-way", FFA4_FIXTURES],
  ] as const)("a click on a monster that can only attack a monster declares it, then the arrow aims from it (%s)", (_name, set) => {
    const onAnswer = vi.fn();
    const { container } = render(<TwoStep set={set} onAnswer={onAnswer} label="Attack with Blue-Eyes White Dragon" next="battle-aim" />);
    pointerClick(attackerButton(container));
    expect(onAnswer).toHaveBeenCalledWith({ choice: "attack:0" });
    expect(document.querySelector("[role='menu']")).toBeNull();
    // The target pick came: the attacker stays declared, so the arrow runs from it to the cursor.
    move(container.querySelector("[data-table-stage]")!);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    const target = foeMonster(container);
    move(target);
    expect(label()).toMatch(/^Attack: /);
    pointerClick(target.matches("button") ? target : (target.querySelector("button") ?? target));
    expect(onAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ selected: expect.any(Array) }));
  });

  it.each([
    ["3-way", FFA3_FIXTURES],
    ["4-way", FFA4_FIXTURES],
  ] as const)("a click on a monster that can only attack directly opens the menu and sends nothing (%s)", (_name, set) => {
    // The engine may start a direct attack with no prompt, or ask a duelist pick that cannot be cancelled: so the player confirms first.
    const onAnswer = vi.fn();
    const { container } = render(<TwoStep set={set} onAnswer={onAnswer} label="Attack directly with Blue-Eyes White Dragon" next="direct-attack" />);
    pointerClick(attackerButton(container));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(document.querySelector("[role='menu']")).not.toBeNull();
  });

  it.each([
    ["3-way", FFA3_FIXTURES],
    ["4-way", FFA4_FIXTURES],
  ] as const)("after the menu sends the attack, the arrow and a board click work on the duelist step (%s)", (_name, set) => {
    const onAnswer = vi.fn();
    const { container } = render(<TwoStep set={set} onAnswer={onAnswer} label="Attack directly with Blue-Eyes White Dragon" next="direct-attack" />);
    pointerClick(attackerButton(container));
    const item = document.querySelector<HTMLElement>("[role='menu'] [role='menuitem'], [role='menu'] button")!;
    act(() => void fireEvent.click(item));
    expect(onAnswer).toHaveBeenCalledWith({ choice: "attack:0" });
    move(container.querySelector("[data-table-stage]")!);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    const field = container.querySelector<HTMLElement>("[data-seat-field='1']")!;
    move(field);
    expect(label()).toMatch(/^Direct attack: /);
    pointerClick(field);
    expect(onAnswer).toHaveBeenLastCalledWith({ choice: "direct-1" });
  });
});

describe("the card menu draws no aim: the arrow starts after Attack is clicked", () => {
  const MZONE = 4;
  const attacker = "0:4:0";
  const attackLine = () => document.querySelector("[data-attack-line]")?.getAttribute("data-attack-line") ?? "off";

  /** Step 0: a monster with Activate and Attack in its menu. Step 1: the attack target pick the engine sends after Attack. */
  function Menu({ set, onAnswer }: { set: TableFixtureSet; onAnswer: Answer }) {
    const [step, setStep] = React.useState<0 | 1>(0);
    const base = (set.states as Record<string, TableFixtureState>)["battle-aim"];
    const prompt =
      step === 0
        ? ({
            id: "attack-action",
            seat: 0,
            kind: "choice",
            title: "Battle",
            context: { type: "action", phase: "battle" },
            options: [
              { id: "act:0", label: "Activate \u2014 Special Summon", controller: 0, location: MZONE, sequence: 0 },
              { id: "attack:0", label: "Attack with Blue-Eyes Spirit Dragon", controller: 0, location: MZONE, sequence: 0 },
            ],
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
  ] as const)("no arrow and no target ring while the menu is open, on hover or focus of Attack (%s)", (_name, set) => {
    const onAnswer = vi.fn();
    const { container } = render(<Menu set={set} onAnswer={onAnswer} />);
    const monster = container.querySelector<HTMLElement>(`[data-zones~="${attacker}"]`)!;
    pointerClick(monster.matches("button") ? monster : (monster.querySelector<HTMLElement>("button") ?? monster));
    const items = Array.from(document.querySelectorAll<HTMLElement>("[role='menu'] [role='menuitem']"));
    expect(items.length).toBe(2);
    const attack = items.find((item) => /^Attack/.test(item.textContent?.trim() ?? ""))!;
    expect(attackLine()).toBe("off");
    expect(arrow()).toBeNull();
    act(() => void fireEvent.mouseEnter(attack));
    act(() => void fireEvent.focus(attack));
    expect(attackLine()).toBe("off");
    expect(arrow()).toBeNull();
    expect(document.querySelector("[data-aim-hot='true']")).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it.each([
    ["3-way", FFA3_FIXTURES],
    ["4-way", FFA4_FIXTURES],
  ] as const)("Attack starts the aim with no target until the player aims (%s)", (_name, set) => {
    const onAnswer = vi.fn();
    const { container } = render(<Menu set={set} onAnswer={onAnswer} />);
    const monster = container.querySelector<HTMLElement>(`[data-zones~="${attacker}"]`)!;
    pointerClick(monster.matches("button") ? monster : (monster.querySelector<HTMLElement>("button") ?? monster));
    const attack = Array.from(document.querySelectorAll<HTMLElement>("[role='menu'] [role='menuitem']")).find((item) => /^Attack/.test(item.textContent?.trim() ?? ""))!;
    act(() => void fireEvent.click(attack));
    expect(onAnswer).toHaveBeenCalledWith({ choice: "attack:0" });
    expect(document.querySelector("[role='menu']")).toBeNull();
    // Declared, but nothing is aimed: no arrow before the mouse moves, then a free arrow with no label and no hot target.
    expect(arrow()).toBeNull();
    expect(document.querySelector("[data-aim-hot='true']")).toBeNull();
    move(container.querySelector("[data-table-stage]")!);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    expect(label()).toBeNull();
    expect(document.querySelector("[data-aim-hot='true']")).toBeNull();
    // Aiming at a target snaps the arrow to it.
    const target = foeMonster(container);
    move(target);
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("snapped");
    expect(label()).toMatch(/^Attack: /);
    expect(document.querySelector("[data-aim-hot='true']")).not.toBeNull();
  });
});

describe("the attacker stays declared through the Attack directly? question", () => {
  const MZONE = 4;

  function Steps({ set, onAnswer }: { set: TableFixtureSet; onAnswer: Answer }) {
    const [step, setStep] = React.useState(0);
    const base = (set.states as Record<string, TableFixtureState>)["battle-aim"];
    const prompts = [
      {
        id: "attack-action",
        seat: 0,
        kind: "choice",
        title: "Battle",
        context: { type: "action", phase: "battle" },
        options: [{ id: "attack:0", label: "Attack with Dark Magician", controller: 0, location: MZONE, sequence: 0 }],
      },
      {
        id: "attack-directly",
        seat: 0,
        kind: "choice",
        title: "Attack directly?",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
      },
      base.room.engine!.prompt!,
    ];
    const state = { ...base, ui: undefined, room: { ...base.room, engine: { ...base.room.engine!, prompt: { ...prompts[step] } } } } as unknown as TableFixtureState;
    const controller = useFixtureController(state, { reducedMotion: true });
    return (
      <TableShell
        controller={{
          ...controller,
          onAnswer: (answer) => {
            onAnswer(answer);
            if (step < 2) setStep(step + 1);
          },
        }}
      />
    );
  }

  it("the card pick after a No has the arrow from the attacker", () => {
    const onAnswer = vi.fn();
    const { container } = render(<Steps set={FFA3_FIXTURES} onAnswer={onAnswer} />);
    const monster = container.querySelector<HTMLElement>('[data-zones~="0:4:0"]')!;
    pointerClick(monster.matches("button") ? monster : (monster.querySelector<HTMLElement>("button") ?? monster));
    expect(onAnswer).toHaveBeenLastCalledWith({ choice: "attack:0" });
    // The yes/no question: answer it from the prompt.
    const no = Array.from(container.querySelectorAll<HTMLElement>("button")).find((node) => node.textContent?.trim() === "No")!;
    act(() => void fireEvent.click(no));
    expect(onAnswer).toHaveBeenLastCalledWith({ choice: "no" });
    move(container.querySelector("[data-table-stage]")!);
    expect(arrow()).not.toBeNull();
  });
});

describe("the prompt words of the pointer flow", () => {
  const withCancel = (cancelable: boolean) => (state: TableFixtureState) =>
    ({ ...state, room: { ...state.room, engine: { ...state.room.engine!, prompt: { ...state.room.engine!.prompt!, cancelable } } } }) as TableFixtureState;

  it("say to click, and Esc cancels, when the pick can be cancelled", () => {
    const { container } = render(<Shell set={FFA3_FIXTURES} id="battle-aim" onAnswer={vi.fn()} edit={withCancel(true)} />);
    expect(container.textContent).toContain("Click a target to attack. Esc to cancel.");
    expect(container.textContent).not.toContain("Point at a target");
  });

  it("do not offer Esc on a pick that cannot be cancelled (a forced attack)", () => {
    const { container } = render(<Shell set={FFA3_FIXTURES} id="battle-aim" onAnswer={vi.fn()} edit={withCancel(false)} />);
    expect(container.textContent).toContain("Click a target to attack.");
    expect(container.textContent).not.toContain("Esc to cancel");
  });

  it("start with the tap words on a touch-only device (coarse pointer)", () => {
    const stub = (coarse: boolean) =>
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: coarse && query === "(pointer: coarse)", media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    stub(true);
    try {
      const { container } = render(<Shell set={FFA3_FIXTURES} id="battle-aim" onAnswer={vi.fn()} />);
      expect(container.textContent).toContain("Tap a target, then tap again to attack.");
      expect(container.textContent).not.toContain("Click a target");
    } finally {
      stub(false);
    }
  });

  it("say to tap twice once a finger is used", () => {
    const { container } = render(<Shell set={FFA3_FIXTURES} id="battle-aim" onAnswer={vi.fn()} />);
    act(() => void fireEvent.pointerDown(container.querySelector("[data-table-stage]")!, { pointerType: "touch" }));
    expect(container.textContent).toContain("Tap a target, then tap again to attack.");
  });
});

describe("a finger on the direct-attack step", () => {
  it.each([
    ["3-way", FFA3_FIXTURES],
    ["4-way", FFA4_FIXTURES],
  ] as const)("the first tap on a rival board only aims and shows the label; the second tap sends (%s)", (_name, set) => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell set={set} id="direct-attack" onAnswer={onAnswer} />);
    const field = container.querySelector<HTMLElement>("[data-seat-field='1']")!;
    act(() => void fireEvent.pointerDown(field, { pointerType: "touch" }));
    pointerClick(field);
    expect(onAnswer).not.toHaveBeenCalled();
    expect(label()).toMatch(/^Direct attack: /);
    act(() => void fireEvent.pointerDown(field, { pointerType: "touch" }));
    pointerClick(field);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ choice: "direct-1" });
  });
});

describe("the old attack line comes back when the arrow cannot find the attacker", () => {
  const frame = () => act(() => new Promise<void>((resolve) => void requestAnimationFrame(() => resolve())));
  const flag = () => document.documentElement.hasAttribute("data-aim-arrow-on");

  it("sets the root flag only while the attacker is on the page", async () => {
    const pointer = { current: { x: 300, y: 200 } };
    render(<AimArrow fromKey="0:4:0" tone="violet" targetTone={null} pointer={pointer} snap={null} label={null} />);
    await frame();
    expect(flag()).toBe(false);
    const attacker = document.createElement("div");
    attacker.setAttribute("data-zones", "0:4:0");
    document.body.appendChild(attacker);
    await frame();
    expect(flag()).toBe(true);
    attacker.remove();
    await frame();
    expect(flag()).toBe(false);
  });

  it("clears the flag when the arrow goes away", async () => {
    const attacker = document.createElement("div");
    attacker.setAttribute("data-zones", "0:4:0");
    document.body.appendChild(attacker);
    const pointer = { current: { x: 300, y: 200 } };
    const { unmount } = render(<AimArrow fromKey="0:4:0" tone="violet" targetTone={null} pointer={pointer} snap={null} label={null} />);
    await frame();
    expect(flag()).toBe(true);
    unmount();
    expect(flag()).toBe(false);
    attacker.remove();
  });
});
