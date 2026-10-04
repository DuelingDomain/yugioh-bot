// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
import { isAttackTargetPrompt, usePromptDraft } from "@/components/duel/prompts";
import { PromptCenter } from "@/components/duel/prompt-center";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { useAimFlow } from "@/components/duel/table/use-aim-flow";
import { tableLayout } from "@/components/duel/table/geometry";

afterEach(cleanup);
const prompt: DuelPrompt = { id: "combined", seat: 0, kind: "choice", title: "Select an attack target", min: 1, max: 1, cancelable: false,
  options: [
    { id: "direct:1", label: "Attack Player 2 directly", controller: 1 },
    { id: "card:0", label: "Battle Ox", controller: 1, location: 4, sequence: 0 },
    { id: "card:1", label: "Giant Rat", controller: 2, location: 4, sequence: 0 },
  ] };

it("recognizes the combined attack choice for board targeting", () => {
  expect(isAttackTargetPrompt(prompt)).toBe(true);
});

it.each(["direct:1", "card:0"])("the prompt panel submits %s as one target choice", (id) => {
  const submit = vi.fn();
  function Panel() {
    const draft = usePromptDraft(prompt);
    return <PromptCenter prompt={prompt} mySeat={0} active slug="t" busy={false} draft={draft} onSubmit={submit}
      menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} seatTones={new Map()} nameOf={(seat) => `Seat ${seat + 1}`} />;
  }
  render(<Panel />);
  fireEvent.click(id === "direct:1" ? screen.getByRole("button", { name: "Attack Seat 2 directly" }) : screen.getByText("Battle Ox").closest("button")!);
  expect(submit).toHaveBeenCalledExactlyOnceWith({ choice: id });
  expect(screen.queryByText("Attack directly?")).toBeNull();
});

it.each(["direct", "monster"])("one board click selects a %s target when the same seat has both", (target) => {
  const submit = vi.fn();
  const root = document.createElement("div");
  root.innerHTML = '<div data-seat-field="1"><div data-zones="1:4:0">Monster</div><button data-lp-seat="1">LP</button></div>';
  document.body.append(root);
  const state = FFA3_FIXTURES.states["choose-opponent"];
  const fixture = { ...state, room: { ...state.room, engine: { ...state.room.engine!, prompt } } };
  const { result } = renderHook(() => {
    const base = useFixtureController(fixture);
    return useAimFlow({ ...base, onAnswer: submit, seatPick: null, aim: { mode: "preview", from: "0:4:0", to: {} } },
      tableLayout("ffa3", fixture.room.engine!, 0), { current: root });
  });
  expect(result.current.promptAim).not.toBeNull();
  fireEvent.click(root.querySelector(target === "direct" ? "[data-lp-seat]" : "[data-zones]")!, { detail: 1, button: 0 });
  expect(submit).toHaveBeenCalledExactlyOnceWith({ choice: target === "direct" ? "direct:1" : "card:0" });
  root.remove();
});

it.each(["direct:1", "card:0"])("the aiming panel can lock and confirm %s", (id) => {
  const submit = vi.fn();
  const state = FFA3_FIXTURES.states["choose-opponent"];
  const fixture = { ...state, room: { ...state.room, engine: { ...state.room.engine!, prompt } } };
  const { result } = renderHook(() => {
    const base = useFixtureController(fixture);
    return useAimFlow({ ...base, onAnswer: submit, seatPick: null, aim: { mode: "preview", from: "0:4:0", to: {} } },
      tableLayout("ffa3", fixture.room.engine!, 0), { current: null });
  });
  const option = prompt.options.find((o) => o.id === id)!;
  act(() => result.current.promptAim!.onHover(option));
  act(() => result.current.promptAim!.onAim(option));
  expect(result.current.promptAim!.lockedId).toBe(id);
  expect(result.current.pointed).toMatchObject(id === "direct:1" ? { lpSeat: 1 } : { zoneKey: "1:4:0" });
  act(() => result.current.confirm());
  expect(submit).toHaveBeenCalledExactlyOnceWith({ choice: id });
});
