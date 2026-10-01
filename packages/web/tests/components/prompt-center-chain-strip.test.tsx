// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { PromptCenter } from "@/components/duel/prompt-center";
import type { PromptDraft } from "@/components/duel/prompts";

const card = (code: number, name: string): DuelCardInfo => ({
  code, name, description: "Long printed text of the card.", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "Warrior",
});

const draft: PromptDraft = {
  selected: [], setSelected: vi.fn(), counts: {}, setCounts: vi.fn(), value: 0, setValue: vi.fn(),
  cardCode: null, setCardCode: vi.fn(), highlight: 0, setHighlight: vi.fn(),
};

function chainPrompt(options: DuelPrompt["options"]): DuelPrompt {
  return {
    id: "p1", seat: 0, kind: "choice", title: "Select a chain link or pass", cancelable: true,
    context: { type: "chain", forced: false }, options,
  };
}

const twoEffects = [
  { id: "card:0", label: "True Light: Special Summon", card: card(1, "True Light"), effectText: "Special Summon", cardText: "Long printed text." },
  { id: "card:1", label: "True Light: Set 1 Spell/Trap", card: card(1, "True Light"), effectText: "Set 1 Spell/Trap" },
  { id: "card:2", label: "Blue-Eyes Spirit Dragon: Negate", card: card(2, "Blue-Eyes Spirit Dragon") },
];

function mount(prompt: DuelPrompt, onSubmit = vi.fn(), onInspectCard = vi.fn()) {
  render(
    <div>
      <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={onSubmit}
        menuOpen={false} chain={[{ index: 1, name: "The White Stone of Ancients" } as never]} aimLocked={false}
        reducedMotion revision={0} onInspectCard={onInspectCard} />
    </div>,
  );
  return { onSubmit, onInspectCard };
}

afterEach(cleanup);

describe("PromptCenter chain list as a card strip", () => {
  it("shows only cards after Yes: no Activate button, effect text or full-text link", () => {
    mount(chainPrompt(twoEffects));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.queryByText("Activate")).toBeNull();
    expect(screen.queryByText(/Full card text/)).toBeNull();
    expect(screen.queryByText(/Long printed text/)).toBeNull();
    const cards = screen.getAllByRole("button", { name: /^\d\. / });
    expect(cards.map((button) => button.getAttribute("aria-label"))).toEqual([
      "1. True Light · Special Summon",
      "2. True Light · Set 1 Spell/Trap",
      "3. Blue-Eyes Spirit Dragon",
    ]);
    // A card with a single option shows its name only; a repeated card adds one short line.
    expect(screen.getByText("Special Summon")).toBeTruthy();
    expect(screen.getByText("Set 1 Spell/Trap")).toBeTruthy();
    expect(document.querySelector('[data-prompt-panel][data-strip="true"]')).not.toBeNull();
  });

  it("activates the clicked card with the same answer as before and inspects on hover", () => {
    const { onSubmit, onInspectCard } = mount(chainPrompt(twoEffects));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    const cards = screen.getAllByRole("button", { name: /^\d\. / });
    fireEvent.mouseEnter(cards[2]);
    expect(onInspectCard).toHaveBeenLastCalledWith(expect.objectContaining({ code: 2 }));
    fireEvent.click(cards[1]);
    expect(onSubmit).toHaveBeenCalledWith({ choice: "card:1" });
  });

  it("keeps Back to the bar and Pass in the footer", () => {
    const { onSubmit } = mount(chainPrompt(twoEffects));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    expect(onSubmit).toHaveBeenCalledWith({ cancel: true });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
  });

  it("keeps the rows when an option is not a card", () => {
    mount(chainPrompt([twoEffects[0], { id: "x", label: "Something else" }]));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.getAllByText("Activate").length).toBeGreaterThan(0);
  });
});
