// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelMasterRule } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
// These tests exercise the DOM field and labels; jsdom has no WebGL canvas.
vi.mock("@/components/duel/fx3d/loader", () => ({ loadFx3d: async () => null }));

import { DuelField } from "@/components/duel/field";
import { FxLab } from "@/components/duel/fx-lab/lab";
import { findScenario } from "@/components/duel/fx-lab/scenarios";
import { newBoard } from "@/components/duel/fx-lab/board";
import { clearPromptRevealHold, holdPromptReveal, REVEAL_TIMING } from "@/components/duel/prompt-reveal";
import { planPhaseBeats, resetPhaseBeats } from "@/components/duel/phase-beats";

afterEach(() => { cleanup(); clearPromptRevealHold(); resetPhaseBeats(); vi.useRealTimers(); });

function view(extra: Partial<DuelEngineView> = {}): DuelEngineView {
  return { revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats: newBoard().seats,
    prompt: null, chain: [], events: [], log: [], result: null, ...extra };
}
function field(engine: DuelEngineView, mySeat: number | null = 0, rule: DuelMasterRule = 5, reduced = false, priorityLive?: boolean) {
  return <DuelField engine={engine} mySeat={mySeat} masterRule={rule} reducedMotion={reduced} priorityLive={priorityLive}
    legalKeys={new Set()} selectedKeys={new Set()} onActivate={() => {}} onInspect={() => {}}
    bottomName="Yugi" topName="Kaiba" />;
}
const half = (container: HTMLElement, seat: number) => container.querySelector(`[data-field-seat="${seat}"]`)!;

describe("field turn and priority", () => {
  it.each([[0, 0], [0, 1], [1, 1], [1, 0]] as const)("shows turn %i and priority %i independently", (turnSeat, prioritySeat) => {
    const { container } = render(field(view({ turnSeat, prioritySeat })));
    expect(half(container, turnSeat)?.getAttribute("data-turn")).toBe("true");
    expect(half(container, 1 - turnSeat)?.getAttribute("data-turn")).toBe("false");
    expect(half(container, prioritySeat)?.getAttribute("data-priority")).toBe("true");
    expect(half(container, 1 - prioritySeat)?.getAttribute("data-priority")).toBe("false");
    expect(screen.getByText("Turn").closest("[data-lp-seat]")?.getAttribute("data-lp-seat")).toBe(String(turnSeat));
    expect(screen.getByText(prioritySeat === 0 ? "Your move" : "Opponent to act").closest("[data-lp-seat]")?.getAttribute("data-lp-seat")).toBe(String(prioritySeat));
  });

  it("moves purple alone on a response window, then moves gold on the next turn", () => {
    const { container, rerender } = render(field(view({ prioritySeat: 0 })));
    rerender(field(view({ revision: 2, prioritySeat: 1 })));
    expect(half(container, 0).getAttribute("data-turn")).toBe("true");
    expect(half(container, 1).getAttribute("data-priority")).toBe("true");
    rerender(field(view({ revision: 3, turnSeat: 1, prioritySeat: 1 })));
    expect(half(container, 1).getAttribute("data-turn")).toBe("true");
    expect(half(container, 0).getAttribute("data-turn")).toBe("false");
  });

  it("orients both states for a player in seat 1", () => {
    const { container } = render(field(view({ turnSeat: 0, prioritySeat: 1 }), 1));
    expect(half(container, 1).getAttribute("data-side")).toBe("bottom");
    expect(screen.getByText("Your move").closest("[data-lp-seat]")?.getAttribute("data-lp-seat")).toBe("1");
  });

  it("names the actor for a spectator", () => {
    render(field(view({ prioritySeat: 1 }), null));
    expect(screen.getByLabelText("Kaiba to act")).toBeTruthy();
    expect(screen.queryByText("Your move")).toBeNull();
  });

  it("keeps the action label separate from a long spectator name", () => {
    const name = "VeryLongDiscordDisplayName123456";
    render(<DuelField engine={view({ prioritySeat: 1 })} mySeat={null} masterRule={5} reducedMotion
      legalKeys={new Set()} selectedKeys={new Set()} onActivate={() => {}} onInspect={() => {}}
      bottomName="Yugi" topName={name} />);
    const label = screen.getByLabelText(`${name} to act`);
    expect(label.getAttribute("title")).toBe(`${name} to act`);
    expect(label.textContent).toBe("to act");
    expect(label.parentElement?.querySelector("span")?.textContent).toBe(name);
  });

  it.each([1, 2, 3, 4, 5] as const)("hugs the zones in Master Rule %i", (rule) => {
    const { container } = render(field(view({ prioritySeat: 1 }), 0, rule));
    expect(half(container, 1).querySelector('[data-kind="mz"]')).toBeTruthy();
    expect(half(container, 1).querySelector("[data-field-signals]")).toBeTruthy();
    expect(container.querySelectorAll('[data-kind="emz"]')).toHaveLength(rule >= 4 ? 2 : 0);
  });

  it("keeps signals and usable-card glows together in a Domain field", () => {
    const script = findScenario("state-priority-your-turn-you")!.build();
    script.initial.seats[0].deckMaster = {
      card: { code: 89631139, name: "Blue-Eyes White Dragon", description: "", type: 1,
        attack: 3000, defense: 2500, level: 8, attribute: 16, race: "dragon" },
      inZone: true, returns: 0, nextCost: 0,
    };
    const { container } = render(<DuelField engine={view({ seats: script.initial.seats, prioritySeat: 0 })}
      mySeat={0} masterRule={5} reducedMotion legalKeys={new Set(script.legalKeys)}
      selectedKeys={new Set()} onActivate={() => {}} onInspect={() => {}} bottomName="Yugi" topName="Kaiba" />);
    expect(half(container, 0).getAttribute("data-turn")).toBe("true");
    expect(half(container, 0).getAttribute("data-priority")).toBe("true");
    expect(half(container, 0).querySelector('[data-state="usable"]')).toBeTruthy();
    expect(container.querySelector('[data-duel-field]')?.getAttribute("data-reduced-motion")).toBe("true");
  });

  it("retains turn but clears priority when nobody is being prompted", () => {
    const { container } = render(field(view({ prioritySeat: null })));
    expect(container.querySelector('[data-priority="true"]')).toBeNull();
    expect(screen.getByText("Turn")).toBeTruthy();
  });

  it.each([view({ turn: 0, prioritySeat: 0 }), view({ result: { winnerSeat: 0, reason: "Finished" }, prioritySeat: 0 })])("has no activity in opening or finished games", (engine) => {
    const { container } = render(field(engine));
    expect(container.querySelector('[data-turn="true"], [data-priority="true"]')).toBeNull();
    expect(screen.queryByText("Turn")).toBeNull();
  });

  it("holds priority while a board effect is playing and restores it when settled", async () => {
    vi.useFakeTimers();
    holdPromptReveal(2400);
    const events: DuelEngineView["events"] = [{ id: 1, kind: "phase", text: "Main" }];
    const { container, rerender } = render(field(view({ prioritySeat: 1, events })));
    expect(container.querySelector('[data-priority="true"]')).toBeNull();
    expect(screen.getByText("Turn")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
    expect(container.querySelector('[data-priority="true"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2400 + REVEAL_TIMING.settleMs); });
    expect(half(container, 1).getAttribute("data-priority")).toBe("true");
    rerender(field(view({ revision: 2, prioritySeat: 0, events })));
    expect(half(container, 0).getAttribute("data-priority")).toBe("true");
  });

  it("caps the field wait at the prompt panel's timeout", async () => {
    vi.useFakeTimers();
    holdPromptReveal(12_000);
    const { container } = render(field(view({ prioritySeat: 0, events: [{ id: 2, kind: "damage", seat: 1, amount: 1000, text: "Damage" }] })));
    await act(async () => { await vi.advanceTimersByTimeAsync(REVEAL_TIMING.capMs); });
    expect(half(container, 0).getAttribute("data-priority")).toBe("true");
  });

  it("follows the room's reveal for local priority without another animation wait", () => {
    holdPromptReveal(12_000);
    const engine = view({ prioritySeat: 0, events: [{ id: 2, kind: "damage", seat: 1, amount: 1000, text: "Damage" }] });
    const { container, rerender } = render(field(engine, 0, 5, false, false));
    expect(container.querySelector('[data-priority="true"]')).toBeNull();
    rerender(field(engine, 0, 5, false, true));
    expect(half(container, 0).getAttribute("data-priority")).toBe("true");
  });

  it.each([0, 1])("clears priority %i immediately when the room pauses actions", (prioritySeat) => {
    const engine = view({ prioritySeat });
    const { container, rerender } = render(field(engine, 0, 5, false, true));
    expect(half(container, prioritySeat).getAttribute("data-priority")).toBe("true");
    rerender(field(engine, 0, 5, false, false));
    expect(container.querySelector('[data-priority="true"]')).toBeNull();
    expect(half(container, 0).getAttribute("data-turn")).toBe("true");
  });

  it("ignores CSS transitions and the prompt panel's entrance animation", async () => {
    vi.useFakeTimers();
    const panel = document.createElement("div");
    panel.setAttribute("data-prompt-panel", "");
    const target = panel.appendChild(document.createElement("div"));
    const animation = {
      constructor: { name: "CSSAnimation" }, playState: "running",
      effect: { target, getTiming: () => ({ iterations: 1 }) }, finished: new Promise(() => {}),
    };
    const transition = { ...animation, constructor: { name: "CSSTransition" }, effect: { getTiming: () => ({ iterations: 1 }) } };
    const { container } = render(field(view({ prioritySeat: 1, events: [{ id: 3, kind: "activate", seat: 0, text: "Activate" }] })));
    Object.defineProperty(container, "getAnimations", { value: () => [animation, transition] });
    await act(async () => { await vi.advanceTimersByTimeAsync(REVEAL_TIMING.beatMs + REVEAL_TIMING.settleMs); });
    expect(half(container, 1).getAttribute("data-priority")).toBe("true");
  });

  it("withholds priority until the opening phase sequence finishes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    const events: DuelEngineView["events"] = [
      { id: 10, kind: "phase", text: "Draw Phase" },
      { id: 11, kind: "phase", text: "Standby Phase" },
      { id: 12, kind: "phase", text: "Main Phase 1" },
    ];
    planPhaseBeats(events, 0, { now: performance.now() + 1600, reduced: false, duelKey: "priority-phase-test" });
    const { container } = render(field(view({ prioritySeat: 0, events })));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(container.querySelector('[data-priority="true"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(half(container, 0).getAttribute("data-priority")).toBe("true");
  });

  it.each([false, true])("waits for finite CSS feedback with reduced motion %s, ignoring ambient pulses", async (reduced) => {
    vi.useFakeTimers();
    let finish!: () => void;
    const banner = {
      constructor: { name: "CSSAnimation" }, playState: "running",
      effect: { getTiming: () => ({ iterations: 1 }) }, finished: new Promise<void>((resolve) => { finish = resolve; }),
    };
    const glow = { ...banner, effect: { getTiming: () => ({ iterations: Infinity }) } };
    const { container } = render(field(view({ prioritySeat: 1, events: [{ id: 3, kind: "activate", seat: 0, text: "Activate" }] }), 0, 5, reduced));
    Object.defineProperty(container, "getAnimations", { value: () => [banner, glow] });
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(container.querySelector('[data-priority="true"]')).toBeNull();
    banner.playState = "finished";
    finish();
    await act(async () => { await vi.advanceTimersByTimeAsync(reduced ? 0 : REVEAL_TIMING.settleMs); });
    expect(half(container, 1).getAttribute("data-priority")).toBe("true");
  });
});

const SCENES = [
  ["state-priority-your-turn-you", "Your turn, you have priority", 0, 0],
  ["state-priority-your-turn-opponent", "Your turn, opponent has priority (chain response)", 0, 1],
  ["state-priority-opponent-turn-opponent", "Opponent's turn, opponent has priority", 1, 1],
  ["state-priority-opponent-turn-you", "Opponent's turn, you have priority", 1, 0],
  ["state-priority-nobody", "Nobody to act", 0, null],
] as const;

describe("priority lab scenes", () => {
  it.each(SCENES)("previews %s with the real field states", (id, name, turnSeat, prioritySeat) => {
    expect(findScenario(id)?.name).toBe(name);
    const { container } = render(<FxLab />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name.replace(/[()]/g, "\\$&")) }));
    expect(half(container, turnSeat)?.getAttribute("data-turn")).toBe("true");
    expect(container.querySelectorAll('[data-field-seat][data-priority="true"]')).toHaveLength(prioritySeat == null ? 0 : 1);
    if (prioritySeat != null) expect(half(container, prioritySeat).getAttribute("data-priority")).toBe("true");
  });
});
