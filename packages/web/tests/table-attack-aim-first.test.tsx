// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { aimPromptFor, aimTargetOf, attackAimOf, isAttackStepPrompt, queuedAnswer } from "@/components/duel/table/attack-aim";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { FFA3_FIXTURES, ffa3Variant } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES, ffa4Variant } from "@/components/duel/table/fixtures/ffa4";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import type { TableController } from "@/components/duel/table/types";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { TagShell } from "@/components/duel/tag/tag-shell";

const MZONE = 4;

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

const move = (target: Element | Window, x = 400, y = 300) => act(() => void fireEvent.pointerMove(target, { clientX: x, clientY: y }));
const pointerClick = (target: Element) => act(() => void fireEvent.click(target, { detail: 1, button: 0 }));
const press = (key: string) => act(() => void fireEvent.keyDown(window, { key }));
const arrow = () => document.querySelector<HTMLElement>("[data-aim-arrow]");
const label = () => document.querySelector("[data-aim-label]:not([hidden])")?.textContent ?? null;
const pressable = (node: HTMLElement) => (node.matches("button") ? node : (node.querySelector<HTMLElement>("button") ?? node));

/** The attack declaration of the viewer's first monster, as the core's action prompt lists it. */
const actionPrompt = (attackLabel: string): DuelPrompt => ({
  id: "attack-action",
  seat: 0,
  kind: "choice",
  title: "Battle",
  context: { type: "action", phase: "battle" },
  options: [{ id: "attack:0", label: attackLabel, controller: 0, location: MZONE, sequence: 0 }],
});

/** The core's own target step, as the table of 3 or 4 sends it after the declaration. */
const targetPrompt = (seat: number, sequence: number): DuelPrompt => ({
  id: "attack-target",
  seat: 0,
  kind: "cards",
  title: "Select an attack target",
  min: 1,
  max: 1,
  options: [{ id: "core-card", label: "Monster", controller: seat, location: MZONE, sequence }],
});

const mainPrompt: DuelPrompt = {
  id: "main-action",
  seat: 0,
  kind: "choice",
  title: "Main Phase 2",
  context: { type: "action", phase: "main" },
  options: [{ id: "to_ep", label: "End Phase" }],
};

/** The state with the listed rival seats holding only the kept monsters (a rival with an empty list is open to a direct attack). */
function withBoards(state: TableFixtureState, boards: Partial<Record<number, number[]>>): TableFixtureState {
  const engine = state.room.engine!;
  const seats = engine.seats.map((view) => {
    const keep = boards[view.seat];
    return keep ? { ...view, monsters: view.monsters.map((card, index) => (keep.includes(index) ? card : null)) } : view;
  });
  return { ...state, ui: undefined, room: { ...state.room, engine: { ...engine, seats } } } as TableFixtureState;
}

/** Plays the given prompts in order: each answer, from the player or queued, moves to the next one. A null prompt is an engine step without a question. */
function Flow({
  Shell,
  state,
  prompts,
  onAnswer,
  revisions,
}: {
  Shell: typeof TableShell | typeof TagShell;
  state: TableFixtureState;
  prompts: (DuelPrompt | null)[];
  onAnswer: (answer: DuelAnswer) => void;
  /** The engine revision of each step; by default the revision grows by one with each step, as the engine does. */
  revisions?: number[];
}) {
  const [step, setStep] = React.useState(0);
  const revision = revisions ? revisions[Math.min(step, revisions.length - 1)] : (state.room.engine!.revision ?? 0) + step;
  const source = { ...state, room: { ...state.room, engine: { ...state.room.engine!, revision, prompt: prompts[step] } } } as TableFixtureState;
  const controller = useFixtureController(source, { reducedMotion: true });
  const wrapped: TableController = {
    ...controller,
    onAnswer: (answer) => {
      onAnswer(answer);
      setStep((current) => Math.min(current + 1, prompts.length - 1));
    },
  };
  return <Shell controller={wrapped} />;
}

const attackerOf = (container: HTMLElement) => pressable(container.querySelector<HTMLElement>('[data-zones~="0:4:0"]')!);
const monsterOf = (container: HTMLElement, seat: number, sequence: number) => pressable(container.querySelector<HTMLElement>(`[data-zones~="${seat}:4:${sequence}"]`)!);
const stage = (container: HTMLElement) => container.querySelector("[data-table-stage]")!;

interface Scene {
  name: string;
  Shell: typeof TableShell | typeof TagShell;
  state: TableFixtureState;
  /** The one living rival (or the rival that is not hidden behind monsters). */
  rival: number;
}

const ffa3Scene = (): Scene => ({
  name: "3-way with 2 alive",
  Shell: TableShell,
  state: (ffa3Variant(FFA3_FIXTURES, { out: [2] }).states as Record<string, TableFixtureState>)["battle-aim"],
  rival: 1,
});
const ffa4Scene = (): Scene => ({
  name: "4-way with 2 alive",
  Shell: TableShell,
  state: (ffa4Variant(FFA4_FIXTURES, { out: [1, 2] }).states as Record<string, TableFixtureState>)["battle-aim"],
  rival: 3,
});
const tagScene = (): Scene => ({
  name: "Tag",
  Shell: TagShell,
  state: (TAG_FIXTURES.states as Record<string, TableFixtureState>)["battle-aim"],
  rival: 3,
});
const scenes = [ffa3Scene, ffa4Scene, tagScene].map((make) => [make().name, make] as const);

describe.each(scenes)("attack aim first on the table: %s", (_name, make) => {
  /** The first monster of the rival seat: the one legal target. */
  const firstMonster = (scene: Scene) => scene.state.room.engine!.seats.find((view) => view.seat === scene.rival)!.monsters.findIndex((card) => card != null);

  it("one legal monster target: the click on the attacker and on Attack send nothing, the click on the target sends the attack", () => {
    const scene = make();
    const sequence = firstMonster(scene);
    const state = withBoards(scene.state, { [scene.rival]: [sequence], ...(scene.Shell === TagShell ? { 1: [sequence] } : {}) });
    const onAnswer = vi.fn();
    const { container } = render(
      <Flow Shell={scene.Shell} state={state} prompts={[actionPrompt("Attack with Blue-Eyes White Dragon"), targetPrompt(scene.rival, sequence), mainPrompt]} onAnswer={onAnswer} />,
    );
    pointerClick(attackerOf(container));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(document.querySelector("[role='menu']")).toBeNull();
    move(stage(container));
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    // Hover aims, and still nothing is sent.
    move(monsterOf(container, scene.rival, sequence));
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("snapped");
    expect(label()).toMatch(/^Attack: /);
    expect(onAnswer).not.toHaveBeenCalled();
    pointerClick(monsterOf(container, scene.rival, sequence));
    // The attack, then the core's target step answered with the same monster. The step after it is not touched.
    expect(onAnswer.mock.calls.map(([answer]) => answer)).toEqual([{ choice: "attack:0" }, { selected: ["core-card"] }]);
  });

  it("a menu Attack with several choices on the card also waits for the target", () => {
    const scene = make();
    const sequence = firstMonster(scene);
    const state = withBoards(scene.state, { [scene.rival]: [sequence], ...(scene.Shell === TagShell ? { 1: [sequence] } : {}) });
    const onAnswer = vi.fn();
    const menu: DuelPrompt = {
      ...actionPrompt("Attack with Blue-Eyes White Dragon"),
      options: [{ id: "act:0", label: "Activate — Special Summon", controller: 0, location: MZONE, sequence: 0 }, actionPrompt("Attack with Blue-Eyes White Dragon").options[0]],
    };
    const { container } = render(<Flow Shell={scene.Shell} state={state} prompts={[menu, targetPrompt(scene.rival, sequence), mainPrompt]} onAnswer={onAnswer} />);
    pointerClick(attackerOf(container));
    const attack = Array.from(document.querySelectorAll<HTMLElement>("[role='menu'] [role='menuitem']")).find((item) => /^Attack/.test(item.textContent?.trim() ?? ""))!;
    act(() => void fireEvent.click(attack));
    expect(onAnswer).not.toHaveBeenCalled();
    move(stage(container));
    expect(arrow()).not.toBeNull();
    pointerClick(monsterOf(container, scene.rival, sequence));
    expect(onAnswer.mock.calls[0]).toEqual([{ choice: "attack:0" }]);
  });

  it("a direct attack on the one open rival: the engine asks nothing, the UI still aims and sends only on the click", () => {
    const scene = make();
    // The rival has no monster: the core skips the duelist step for one living rival that can be hit directly.
    const state = withBoards(scene.state, { [scene.rival]: [], ...(scene.Shell === TagShell ? { 1: [firstMonster(scene)] } : {}) });
    const onAnswer = vi.fn();
    const { container } = render(
      <Flow Shell={scene.Shell} state={state} prompts={[actionPrompt("Attack directly with Blue-Eyes White Dragon"), null]} onAnswer={onAnswer} />,
    );
    pointerClick(attackerOf(container));
    expect(onAnswer).not.toHaveBeenCalled();
    move(stage(container));
    expect(arrow()?.getAttribute("data-aim-arrow")).toBe("free");
    const chip = container.querySelector<HTMLElement>(`[data-lp-seat='${scene.rival}']`)!;
    move(chip);
    expect(label()).toMatch(/^Direct attack: /);
    expect(onAnswer).not.toHaveBeenCalled();
    pointerClick(chip);
    expect(onAnswer.mock.calls.map(([answer]) => answer)).toEqual([{ choice: "attack:0" }]);
  });

  it("Esc and a right click end the aim and send nothing; the attack can be aimed again", () => {
    const scene = make();
    const sequence = firstMonster(scene);
    const state = withBoards(scene.state, { [scene.rival]: [sequence], ...(scene.Shell === TagShell ? { 1: [sequence] } : {}) });
    const onAnswer = vi.fn();
    const { container } = render(<Flow Shell={scene.Shell} state={state} prompts={[actionPrompt("Attack with Blue-Eyes White Dragon"), targetPrompt(scene.rival, sequence)]} onAnswer={onAnswer} />);
    pointerClick(attackerOf(container));
    move(stage(container));
    expect(arrow()).not.toBeNull();
    press("Escape");
    expect(arrow()).toBeNull();
    pointerClick(attackerOf(container));
    move(stage(container));
    expect(arrow()).not.toBeNull();
    act(() => void fireEvent.contextMenu(stage(container)));
    expect(arrow()).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
    // After a cancel, a click on a rival monster is just a click: it sends nothing.
    pointerClick(monsterOf(container, scene.rival, sequence));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("a click on your own monster or on a board with no target while aiming sends nothing", () => {
    const scene = make();
    const sequence = firstMonster(scene);
    const state = withBoards(scene.state, { [scene.rival]: [sequence], ...(scene.Shell === TagShell ? { 1: [sequence] } : {}) });
    const onAnswer = vi.fn();
    const { container } = render(<Flow Shell={scene.Shell} state={state} prompts={[actionPrompt("Attack with Blue-Eyes White Dragon"), targetPrompt(scene.rival, sequence)]} onAnswer={onAnswer} />);
    pointerClick(attackerOf(container));
    move(stage(container));
    const own = container.querySelector<HTMLElement>("[data-seat-field='0']");
    if (own) {
      move(own);
      pointerClick(own);
    }
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe("attack aim first: the queued target", () => {
  const setup = (prompts: (DuelPrompt | null)[], revisions?: number[]) => {
    const scene = ffa3Scene();
    const sequence = scene.state.room.engine!.seats.find((view) => view.seat === 1)!.monsters.findIndex((card) => card != null);
    const state = withBoards(scene.state, { 1: [sequence, sequence + 1 < 5 ? sequence + 1 : sequence] });
    const onAnswer = vi.fn();
    const view = render(<Flow Shell={TableShell} state={state} prompts={prompts} onAnswer={onAnswer} revisions={revisions} />);
    return { ...view, onAnswer, sequence };
  };

  it("a core step that does not offer the target is left to the player (nothing is answered for them)", () => {
    const { container, onAnswer, sequence } = setup([
      actionPrompt("Attack with Blue-Eyes White Dragon"),
      // The core asks for another monster than the one aimed at: the table does not guess.
      { ...targetPrompt(1, 99), options: [{ id: "other", label: "Other", controller: 1, location: MZONE, sequence: 99 }] },
    ]);
    pointerClick(attackerOf(container));
    move(stage(container));
    pointerClick(monsterOf(container, 1, sequence));
    expect(onAnswer.mock.calls.map(([answer]) => answer)).toEqual([{ choice: "attack:0" }]);
  });

  it("an unrelated prompt after the attack is never answered from the remembered target", () => {
    const { container, onAnswer, sequence } = setup([actionPrompt("Attack with Blue-Eyes White Dragon"), mainPrompt]);
    pointerClick(attackerOf(container));
    move(stage(container));
    pointerClick(monsterOf(container, 1, sequence));
    expect(onAnswer.mock.calls.map(([answer]) => answer)).toEqual([{ choice: "attack:0" }]);
  });

  it("the Attack directly? question is answered No for a monster target", () => {
    const yesNo: DuelPrompt = {
      id: "attack-directly",
      seat: 0,
      kind: "choice",
      title: "Attack directly?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    };
    const { container, onAnswer, sequence } = setup([actionPrompt("Attack with Blue-Eyes White Dragon"), yesNo, mainPrompt]);
    pointerClick(attackerOf(container));
    move(stage(container));
    pointerClick(monsterOf(container, 1, sequence));
    expect(onAnswer.mock.calls.map(([answer]) => answer)).toEqual([{ choice: "attack:0" }, { choice: "no" }]);
  });
});

describe("attack aim first: the revision of the queued target", () => {
  const base = (ffa3Scene().state.room.engine!.revision ?? 0) + 0;
  const setup = (prompts: (DuelPrompt | null)[], revisions: number[]) => {
    const scene = ffa3Scene();
    const sequence = scene.state.room.engine!.seats.find((view) => view.seat === 1)!.monsters.findIndex((card) => card != null);
    const state = withBoards(scene.state, { 1: [sequence] });
    const onAnswer = vi.fn();
    const view = render(<Flow Shell={TableShell} state={state} prompts={prompts} onAnswer={onAnswer} revisions={revisions} />);
    return { ...view, onAnswer, sequence };
  };
  const aimAndSend = (container: HTMLElement, sequence: number) => {
    pointerClick(attackerOf(container));
    move(stage(container));
    pointerClick(monsterOf(container, 1, sequence));
  };

  it("a replay target pick at the sent revision + 3 that offers the saved target gets no automatic answer", () => {
    const scene = ffa3Scene();
    const sequence = scene.state.room.engine!.seats.find((view) => view.seat === 1)!.monsters.findIndex((card) => card != null);
    const { container, onAnswer } = setup([actionPrompt("Attack with Blue-Eyes White Dragon"), targetPrompt(1, sequence)], [base, base + 3]);
    aimAndSend(container, sequence);
    expect(onAnswer.mock.calls.map(([answer]) => answer)).toEqual([{ choice: "attack:0" }]);
  });

  it("the same pick at the sent revision + 1 is answered", () => {
    const scene = ffa3Scene();
    const sequence = scene.state.room.engine!.seats.find((view) => view.seat === 1)!.monsters.findIndex((card) => card != null);
    const { container, onAnswer } = setup([actionPrompt("Attack with Blue-Eyes White Dragon"), targetPrompt(1, sequence)], [base, base + 1]);
    aimAndSend(container, sequence);
    expect(onAnswer.mock.calls.map(([answer]) => answer)).toEqual([{ choice: "attack:0" }, { selected: ["core-card"] }]);
  });

  it("after No to Attack directly?, the target pick is answered at +2 and not at +1 or +3", () => {
    const scene = ffa3Scene();
    const sequence = scene.state.room.engine!.seats.find((view) => view.seat === 1)!.monsters.findIndex((card) => card != null);
    const yesNo: DuelPrompt = { id: "attack-directly", seat: 0, kind: "choice", title: "Attack directly?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] };
    const run = (revisions: number[]) => {
      const view = setup([actionPrompt("Attack with Blue-Eyes White Dragon"), yesNo, targetPrompt(1, sequence)], revisions);
      aimAndSend(view.container, sequence);
      const answers = view.onAnswer.mock.calls.map(([answer]) => answer);
      view.unmount();
      return answers;
    };
    expect(run([base, base + 1, base + 2])).toEqual([{ choice: "attack:0" }, { choice: "no" }, { selected: ["core-card"] }]);
    expect(run([base, base + 1, base + 3])).toEqual([{ choice: "attack:0" }, { choice: "no" }]);
    expect(run([base, base + 1, base + 1])).toEqual([{ choice: "attack:0" }, { choice: "no" }]);
  });
});

describe("attack aim first: the Cancel button of the bar", () => {
  it("shows Cancel with no locked aim; a click ends the aim and sends nothing", () => {
    const scene = ffa3Scene();
    const sequence = scene.state.room.engine!.seats.find((view) => view.seat === 1)!.monsters.findIndex((card) => card != null);
    const state = withBoards(scene.state, { 1: [sequence] });
    const onAnswer = vi.fn();
    const { container } = render(<Flow Shell={TableShell} state={state} prompts={[actionPrompt("Attack with Blue-Eyes White Dragon"), targetPrompt(1, sequence)]} onAnswer={onAnswer} />);
    pointerClick(attackerOf(container));
    move(stage(container));
    expect(arrow()).not.toBeNull();
    const cancel = document.querySelector<HTMLElement>("[data-opponent-bar] button:not([data-rival-seat])")!;
    expect(cancel.textContent).toMatch(/Cancel/);
    act(() => void fireEvent.click(cancel));
    expect(arrow()).toBeNull();
    expect(document.querySelector("[data-opponent-bar]")).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("Tag shows the same Cancel button", () => {
    const scene = tagScene();
    const sequence = scene.state.room.engine!.seats.find((view) => view.seat === scene.rival)!.monsters.findIndex((card) => card != null);
    const state = withBoards(scene.state, { [scene.rival]: [sequence], 1: [sequence] });
    const onAnswer = vi.fn();
    const { container } = render(<Flow Shell={TagShell} state={state} prompts={[actionPrompt("Attack with Blue-Eyes White Dragon"), targetPrompt(scene.rival, sequence)]} onAnswer={onAnswer} />);
    pointerClick(attackerOf(container));
    move(stage(container));
    const cancel = document.querySelector<HTMLElement>("[data-opponent-bar] button:not([data-rival-seat])")!;
    act(() => void fireEvent.click(cancel));
    expect(arrow()).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe("attack-aim helpers", () => {
  const action = actionPrompt("Attack directly with Blue-Eyes White Dragon");

  it("attackAimOf reads a declared attack of an action prompt and nothing else", () => {
    expect(attackAimOf(action, { choice: "attack:0" })).toEqual({ key: "0:4:0", optionId: "attack:0", direct: true });
    expect(attackAimOf(actionPrompt("Attack with Blue-Eyes White Dragon"), { choice: "attack:0" })?.direct).toBe(false);
    expect(attackAimOf(action, { choice: "to_ep" })).toBeNull();
    expect(attackAimOf({ ...action, context: undefined }, { choice: "attack:0" })).toBeNull();
    expect(attackAimOf(null, { choice: "attack:0" })).toBeNull();
  });

  it("aimPromptFor offers every living rival monster, and the open rivals only for a direct attack", () => {
    const engine = withBoards((FFA3_FIXTURES.states as Record<string, TableFixtureState>)["battle-aim"], { 1: [], 2: [0, 1, 2, 3, 4, 5, 6] }).room.engine!;
    const held = engine.seats.find((view) => view.seat === 2)!.monsters.filter((card) => card != null).length;
    expect(held).toBeGreaterThan(0);
    const monsterOnly = aimPromptFor(action, engine, 0, false);
    expect(monsterOnly.options.every((option) => option.controller === 2 && option.location === MZONE)).toBe(true);
    expect(monsterOnly.options).toHaveLength(held);
    expect(isAttackStepPrompt(monsterOnly)).toBe(true);
    const direct = aimPromptFor(action, engine, 0, true);
    expect(direct.options.map((option) => option.id)).toContain("direct:1");
    expect(direct.options.filter((option) => option.id.startsWith("card:"))).toHaveLength(held);
    expect(aimTargetOf(direct.options.find((option) => option.id === "direct:1")!)).toEqual({ seat: 1 });
    expect(aimTargetOf(direct.options.find((option) => option.id.startsWith("card:"))!)).toEqual({ zoneKey: expect.stringMatching(/^2:4:\d$/) });
  });

  it("queuedAnswer maps the remembered target to the step of the core, or null", () => {
    const cards = targetPrompt(1, 2);
    expect(queuedAnswer(cards, { zoneKey: "1:4:2" })).toEqual({ selected: ["core-card"] });
    expect(queuedAnswer(cards, { zoneKey: "1:4:3" })).toBeNull();
    const duelist: DuelPrompt = { id: "d", seat: 0, kind: "choice", title: "Select a duelist to attack", options: [{ id: "direct-1", label: "Attack Ren directly", controller: 1 }] };
    expect(queuedAnswer(duelist, { seat: 1 })).toEqual({ choice: "direct-1" });
    expect(queuedAnswer(duelist, { seat: 2 })).toBeNull();
    const yesNo: DuelPrompt = { id: "y", seat: 0, kind: "choice", title: "Attack directly?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] };
    expect(queuedAnswer(yesNo, { seat: 1 })).toEqual({ choice: "yes" });
    expect(queuedAnswer(yesNo, { zoneKey: "1:4:2" })).toEqual({ choice: "no" });
  });
});

