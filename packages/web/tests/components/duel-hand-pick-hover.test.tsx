// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelField } from "@/components/duel/field";
import { PickRefusalHint } from "@/components/duel/card-interactions";
import { activatePromptFromField, pickRefusal, type PromptDraft } from "@/components/duel/prompts";
import { LOCATION_HAND, zoneKey } from "@/components/duel/constants";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The hand zoom and glow live in CSS, which jsdom does not apply: these tests read the stylesheet for the
// selectors and drive the handlers for the behaviour.
const css = readFileSync(join(import.meta.dirname, "../../src/components/duel/field.module.css"), "utf8");

const hand = (sequence: number, code: number): DuelCard => ({
  controller: 0, location: LOCATION_HAND, sequence, position: 1, code, name: `Hand ${code}`,
});
const cards = [hand(0, 11), hand(1, 12), hand(2, 13)];
const HAND = (sequence: number) => zoneKey(0, LOCATION_HAND, sequence);

const seat = (n: number, extra: Partial<DuelSeatView> = {}): DuelSeatView => ({
  seat: n, lp: 8000, hand: [], deckCount: 10, extraCount: 0, extra: [],
  monsters: [null, null, null, null, null], spells: [null, null, null, null, null], graveyard: [], banished: [],
  ...extra,
});

const engine: DuelEngineView = {
  revision: 1, turn: 1, turnSeat: 0, phase: "main1",
  seats: [seat(0, { hand: cards }), seat(1)],
  prompt: null, chain: [], events: [], log: [], result: null,
};

function board(onActivate = vi.fn(), onHoverCard = vi.fn(), selected: string[] = []) {
  const view = render(
    <DuelField engine={engine} mySeat={0} masterRule={5} reducedMotion={false}
      legalKeys={new Set([HAND(0), HAND(1), HAND(2)])} selectedKeys={new Set(selected)}
      onActivate={onActivate} onHoverCard={onHoverCard} onInspect={() => {}} bottomName="You" topName="Opp" />,
  );
  return { ...view, onActivate, onHoverCard };
}

const zoneButton = (container: HTMLElement, sequence: number) =>
  container.querySelector(`[data-zones~="${HAND(sequence)}"] button`) as HTMLButtonElement;

describe("hand card zoom is driven by the pointer and by keyboard focus only", () => {
  it("never raises a card for plain :focus or :focus-within, which a mouse click leaves behind", () => {
    // Every hand/zone/glow rule that reacts to focus must wait for :focus-visible (not set by a mouse click).
    expect(css).not.toMatch(/:focus-within/);
    expect(css).not.toMatch(/\.handCard[^{]*:focus(?![-\w])/);
    expect(css).not.toMatch(/\.zone[^{]*:focus(?![-\w])[^{]*\.(frame|glow|fanCard|openChip)/);
  });

  it("zooms the hand card on hover and on :focus-visible, in the same rules", () => {
    for (const side of [".handLocal", ".hand:not(.handLocal)"]) {
      const escaped = side.replace(/[.()]/g, "\\$&");
      const re = new RegExp(`${escaped} \\.handCard \\.zone:hover \\.frame,\\s*${escaped} \\.handCard \\.zone:has\\(:focus-visible\\) \\.frame`);
      expect(css, side).toMatch(re);
    }
  });

  it("raises the hovered or keyboard-focused hand card above its neighbours, not a clicked one", () => {
    expect(css).toMatch(/\.handCard:hover,\s*\.handCard:has\(:focus-visible\)\s*\{/);
  });
});

describe("hand card pointer events", () => {
  it("reports the leave right after a click, so no hover is left behind", async () => {
    const { container, onActivate, onHoverCard } = board();
    const user = userEvent.setup();
    const button = zoneButton(container, 0);
    await user.hover(button);
    expect(onHoverCard).toHaveBeenLastCalledWith(cards[0], button);
    await user.click(button);
    expect(onActivate).toHaveBeenCalledTimes(1);
    // The click leaves keyboard focus on the button, which a mouse user never asked for.
    expect(document.activeElement).toBe(button);
    await user.unhover(button);
    expect(onHoverCard).toHaveBeenLastCalledWith(null, null);
  });

  it("reports the leave when the pointer moves from a clicked card to another one", async () => {
    const { container, onHoverCard } = board();
    const user = userEvent.setup();
    const first = zoneButton(container, 0);
    const second = zoneButton(container, 1);
    await user.click(first);
    await user.hover(second);
    expect(onHoverCard).toHaveBeenCalledWith(null, null);
    expect(onHoverCard).toHaveBeenLastCalledWith(cards[1], second);
  });

  it("selects a card at once on a click, with no wait for a leave", async () => {
    const { container, onActivate } = board();
    await userEvent.setup().click(zoneButton(container, 2));
    expect(onActivate).toHaveBeenCalledWith([HAND(2)], cards[2], expect.any(HTMLElement));
  });

  it("keeps a picked card glowing and pressed while it is not hovered", () => {
    const { container } = board(vi.fn(), vi.fn(), [HAND(1)]);
    expect(zoneButton(container, 1).getAttribute("aria-pressed")).toBe("true");
    expect(zoneButton(container, 0).getAttribute("aria-pressed")).toBe("false");
  });
});

function pickPrompt(extra: Partial<DuelPrompt> = {}): DuelPrompt {
  return {
    id: "p1", seat: 0, kind: "cards", title: "Discard 2", min: 2, max: 2,
    options: cards.map((card, index) => ({
      id: `c${index}`, label: card.name ?? "", controller: 0, location: LOCATION_HAND, sequence: index,
    })),
    ...extra,
  } as DuelPrompt;
}

function draftOf(selected: string[]) {
  const state = { selected };
  const setSelected = vi.fn((update: string[] | ((current: string[]) => string[])) => {
    state.selected = typeof update === "function" ? update(state.selected) : update;
  });
  const draft = { get selected() { return state.selected; }, setSelected } as unknown as PromptDraft;
  return { draft, setSelected, state };
}

describe("a click on a hand card during a pick", () => {
  const click = (prompt: DuelPrompt, sequence: number, draft: PromptDraft, onRefuse = vi.fn()) => {
    const handled = activatePromptFromField(prompt, true, [HAND(sequence)], cards[sequence], draft, undefined, onRefuse);
    return { handled, onRefuse };
  };

  it("picks a card while there is room", () => {
    const { draft, state } = draftOf(["c0"]);
    const { onRefuse } = click(pickPrompt(), 1, draft);
    expect(state.selected).toEqual(["c0", "c1"]);
    expect(onRefuse).not.toHaveBeenCalled();
  });

  it("undoes a picked card when it is clicked again", () => {
    const { draft, state } = draftOf(["c0", "c1"]);
    const { onRefuse } = click(pickPrompt(), 1, draft);
    expect(state.selected).toEqual(["c0"]);
    expect(onRefuse).not.toHaveBeenCalled();
  });

  it("refuses a third card with a reason, and changes nothing", () => {
    const { draft, setSelected, state } = draftOf(["c0", "c1"]);
    const { handled, onRefuse } = click(pickPrompt(), 2, draft);
    expect(handled).toBe(true);
    expect(setSelected).not.toHaveBeenCalled();
    expect(state.selected).toEqual(["c0", "c1"]);
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(onRefuse.mock.calls[0][0]).toMatchObject({ reason: "full" });
    expect(onRefuse.mock.calls[0][0].text).toMatch(/undo/i);
  });

  it("then lets the player undo one pick and choose the other card", () => {
    const { draft, state } = draftOf(["c0", "c1"]);
    click(pickPrompt(), 2, draft);
    click(pickPrompt(), 1, draft);
    click(pickPrompt(), 2, draft);
    expect(state.selected).toEqual(["c0", "c2"]);
  });

  it("explains a forced pick that cannot be undone", () => {
    const prompt = pickPrompt({ mandatory: ["c0"] });
    expect(pickRefusal(prompt, ["c0", "c1"], "c0")).toMatchObject({ reason: "mandatory" });
    expect(pickRefusal(prompt, ["c0", "c1"], "c1")).toBeNull();
  });

  it("swaps the pick at once when only one card is allowed", () => {
    const prompt = pickPrompt({ min: 1, max: 1 });
    const onSubmit = vi.fn();
    const { draft } = draftOf([]);
    activatePromptFromField(prompt, true, [HAND(0)], cards[0], draft, onSubmit);
    expect(onSubmit).toHaveBeenCalledWith({ selected: ["c0"] });
  });
});

describe("PickRefusalHint", () => {
  it("shows a status note for the card and removes itself", () => {
    vi.useFakeTimers();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onDone = vi.fn();
    render(<PickRefusalHint anchor={anchor} text="Already picked 2. Click a picked card to undo it" onDone={onDone} />);
    expect(screen.getByRole("status").textContent).toContain("Already picked 2");
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2300); });
    expect(onDone).toHaveBeenCalledTimes(1);
    anchor.remove();
  });
});
