// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("@/components/duel/fx3d/loader", () => ({ loadFx3d: async () => null }));

import { DuelField } from "@/components/duel/field";
import { newBoard } from "@/components/duel/fx-lab/board";
import { DeckSurrenderContext, type DeckSurrenderValue } from "@/components/duel/deck-surrender";
import { PromptCenter } from "@/components/duel/prompt-center";
import type { PromptDraft } from "@/components/duel/prompts";
import { resetPhaseBeats } from "@/components/duel/phase-beats";

beforeAll(() => {
  HTMLElement.prototype.getAnimations = () => [];
});
afterEach(() => { cleanup(); resetPhaseBeats(); vi.useRealTimers(); });

const draft: PromptDraft = {
  selected: [], setSelected: vi.fn(), counts: {}, setCounts: vi.fn(), value: 0, setValue: vi.fn(),
  cardCode: null, setCardCode: vi.fn(), highlight: 0, setHighlight: vi.fn(),
};

// A plain cancelable choice: Escape and a right-click both answer Cancel when nothing else owns them.
const prompt: DuelPrompt = {
  id: "p1", seat: 0, kind: "choice", title: "Select an option", cancelable: true,
  options: [{ id: "a", label: "Option A" }, { id: "b", label: "Option B" }],
};

function view(extra: Partial<DuelEngineView> = {}): DuelEngineView {
  return { revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats: newBoard().seats,
    prompt: null, chain: [], events: [], log: [], result: null, ...extra };
}

/** The room's wiring in miniature: the field's deck menu, the prompt panel, and the menu flag between them. */
function Room({
  onSubmit, engine = view(), current = prompt, surrender = {}, legal = [], busy = false,
}: {
  onSubmit: (answer: unknown) => void;
  engine?: DuelEngineView;
  current?: DuelPrompt;
  surrender?: Partial<DeckSurrenderValue>;
  legal?: string[];
  busy?: boolean;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const value: DeckSurrenderValue = {
    seat: 0, available: true, busy, onSurrender: vi.fn(), scope: `${current.id}|${engine.turnSeat}`,
    onMenuOpenChange: setMenuOpen, ...surrender,
  };
  return (
    <DeckSurrenderContext.Provider value={value}>
      <DuelField engine={engine} mySeat={0} masterRule={5} reducedMotion
        legalKeys={new Set(legal)} selectedKeys={new Set()} onActivate={() => {}} onInspect={() => {}}
        bottomName="Yugi" topName="Kaiba" />
      <PromptCenter prompt={current} mySeat={0} active slug="s" busy={busy} draft={draft} onSubmit={onSubmit}
        menuOpen={menuOpen} chain={[]} aimLocked={false} reducedMotion revision={engine.revision} />
    </DeckSurrenderContext.Provider>
  );
}
const deck = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-field-seat][data-side="bottom"] [data-kind="deck"] button')!;

describe("deck menu next to an open prompt", () => {
  it("answers Cancel on a right-click outside the deck (control)", () => {
    const onSubmit = vi.fn();
    render(<Room onSubmit={onSubmit} />);
    fireEvent.contextMenu(document.body);
    expect(onSubmit).toHaveBeenCalledWith({ cancel: true });
  });

  it("opens the menu on a right-click of the deck and does not answer the prompt", () => {
    const onSubmit = vi.fn();
    const { container } = render(<Room onSubmit={onSubmit} />);
    fireEvent.contextMenu(deck(container));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
