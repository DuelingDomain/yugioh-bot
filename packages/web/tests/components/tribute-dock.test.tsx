// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { PromptCenter } from "@/components/duel/prompt-center";
import { PromptTray, type PromptDraft } from "@/components/duel/prompts";

const MZONE = 0x04;
const GRAVE = 0x10;

const option = (sequence: number, value = 1, extra: Partial<DuelPromptOption> = {}): DuelPromptOption => ({
  id: `card:${sequence}`, label: `Monster ${sequence}`, controller: 0, location: MZONE, sequence, values: [value], ...extra,
});

function tribute(min: number, max: number, values: number[], extra: Partial<DuelPrompt> = {}): DuelPrompt {
  return { id: "t", seat: 0, kind: "tribute", title: "Select tribute(s)", min, max, cancelable: true, options: values.map((v, i) => option(i, v)), ...extra };
}

const draftWith = (selected: string[] = []): PromptDraft => ({
  selected, setSelected: vi.fn(), counts: {}, setCounts: vi.fn(), value: 0, setValue: vi.fn(),
  cardCode: null, setCardCode: vi.fn(), highlight: 0, setHighlight: vi.fn(),
});

function mount(prompt: DuelPrompt, { mySeat = 0, selected = [] as string[], onSubmit = vi.fn(), withTray = false } = {}) {
  const draft = draftWith(selected);
  render(
    <div>
      <div data-zones="0:4:0" data-kind="mzone" />
      <div data-zones="0:4:1" data-kind="mzone" />
      <div data-zones="0:4:2" data-kind="mzone" />
      <div data-hand-seat="0" />
      <PromptCenter prompt={prompt} mySeat={mySeat} active slug="s" busy={false} draft={draft} onSubmit={onSubmit}
        menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={0} />
      {withTray ? <PromptTray prompt={prompt} mySeat={mySeat} active slug="s" busy={false} draft={draft} onSubmit={onSubmit} headless /> : null}
    </div>,
  );
  return { onSubmit, draft };
}

afterEach(cleanup);

describe("the Tribute dock", () => {
  it("docks a compact instruction instead of a centred pick bar", () => {
    mount(tribute(1, 1, [1, 1, 1]));
    const dock = document.querySelector('[data-place="dock"]') as HTMLElement;
    expect(dock).not.toBeNull();
    expect(dock.getAttribute("data-dock")).toBeTruthy();
    expect(screen.getByText("Tribute 1 monster")).toBeTruthy();
    expect(screen.getByText("0/1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("has no Summon button while the pick is short and none for a pick that sends itself", () => {
    mount(tribute(2, 2, [1, 1, 1]), { selected: ["card:0"] });
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Summon" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("offers Summon for a pick worth enough that could still change, and sends it", () => {
    const { onSubmit } = mount(tribute(2, 2, [2, 1, 1]), { selected: ["card:0"] });
    expect(screen.getByText("2/2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Summon" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ selected: ["card:0"] });
  });

  it("Enter takes the same Summon", () => {
    const { onSubmit } = mount(tribute(2, 2, [2, 1, 1]), { selected: ["card:0"], withTray: true });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith({ selected: ["card:0"] });
  });

  it("Cancel, Esc and right-click all cancel while the summon can be cancelled", () => {
    const { onSubmit } = mount(tribute(1, 1, [1, 1]), { withTray: true });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ cancel: true });
    onSubmit.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ cancel: true });
    onSubmit.mockClear();
    fireEvent.pointerDown(document.body, { button: 2 });
    fireEvent.contextMenu(document.body);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ cancel: true });
  });

  it("shows no Cancel and answers no Esc or right-click when the summon cannot be cancelled", () => {
    const { onSubmit } = mount(tribute(1, 1, [1, 1], { cancelable: false }), { withTray: true });
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.contextMenu(document.body);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("is not drawn for the opponent: they see no dock and no glow, only the animation", () => {
    mount(tribute(1, 1, [1, 1]), { mySeat: 1 });
    expect(document.querySelector('[data-place="dock"]')).toBeNull();
    expect(screen.queryByText("Tribute 1 monster")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("falls back to the centred card strip when a candidate is not on the board", () => {
    const prompt = tribute(1, 1, [1, 1], {
      options: [option(0, 1), option(1, 1, { location: GRAVE })],
    });
    mount(prompt);
    expect(document.querySelector('[data-place="dock"]')).toBeNull();
  });
});
