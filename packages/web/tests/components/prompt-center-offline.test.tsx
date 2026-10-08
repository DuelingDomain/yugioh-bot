// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { PromptCenter } from "@/components/duel/prompt-center";
import type { PromptDraft } from "@/components/duel/prompts";

const card = (code: number, name: string): DuelCardInfo => ({
  code, name, description: "", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "Warrior",
});

const draft: PromptDraft = {
  selected: [], setSelected: vi.fn(), counts: {}, setCounts: vi.fn(), value: 0, setValue: vi.fn(),
  cardCode: null, setCardCode: vi.fn(), highlight: 0, setHighlight: vi.fn(),
};

const stripPrompt: DuelPrompt = {
  id: "p1", seat: 0, kind: "choice", title: "Select a card",
  options: [{ id: "o1", label: "Card 1", card: card(1, "Card 1") }, { id: "o2", label: "Card 2", card: card(2, "Card 2") }],
};

function mount(busy: boolean, offline?: boolean) {
  render(
    <PromptCenter prompt={stripPrompt} mySeat={0} active slug="s" busy={busy} offline={offline} draft={draft}
      onSubmit={vi.fn()} menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={0} />,
  );
}

afterEach(cleanup);

describe("PromptCenter card strip while busy", () => {
  it("says Reconnecting when the duel server is down, and keeps the cards disabled", () => {
    mount(true, true);
    expect(screen.getByRole("status").textContent).toBe("Reconnecting…");
    const cards = screen.getAllByRole("button", { name: /^\d\. / });
    expect(cards).toHaveLength(2);
    expect(cards.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("keeps saying Syncing when it is only working or catching up", () => {
    mount(true);
    expect(screen.getByRole("status").textContent).toBe("Syncing…");
  });
});
