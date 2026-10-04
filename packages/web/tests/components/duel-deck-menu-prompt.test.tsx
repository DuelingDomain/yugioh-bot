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

  it("closes the menu on Escape without answering the prompt", () => {
    const onSubmit = vi.fn();
    const { container } = render(<Room onSubmit={onSubmit} />);
    fireEvent.click(deck(container));
    const item = screen.getByRole("menuitem", { name: "Surrender" });
    fireEvent.keyDown(item, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not answer the prompt for other keys typed while the menu is open", () => {
    const onSubmit = vi.fn();
    const { container } = render(<Room onSubmit={onSubmit} />);
    fireEvent.click(deck(container));
    const item = screen.getByRole("menuitem", { name: "Surrender" });
    for (const key of ["1", "2", "n", "y", "f"]) fireEvent.keyDown(item, { key });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("mutes the prompt keys while the menu is open even when focus is elsewhere", () => {
    const onSubmit = vi.fn();
    const { container } = render(<Room onSubmit={onSubmit} />);
    fireEvent.click(deck(container));
    fireEvent.keyDown(document.body, { key: "Escape" });
    // A real right-click is a pointerdown (button 2) and then the contextmenu event.
    fireEvent.pointerDown(document.body, { button: 2 });
    fireEvent.contextMenu(document.body);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("answers the prompt again once the menu is closed", () => {
    const onSubmit = vi.fn();
    const { container } = render(<Room onSubmit={onSubmit} />);
    fireEvent.click(deck(container));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Surrender" }), { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onSubmit).toHaveBeenCalledWith({ cancel: true });
  });
});

describe("prompt panel key guard", () => {
  it("ignores keys that come from inside any menu, even when the room did not flag one", () => {
    const onSubmit = vi.fn();
    render(
      <div>
        <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={onSubmit}
          menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={0} />
        <div role="menu"><button type="button" role="menuitem">Row</button></div>
      </div>,
    );
    const row = screen.getByRole("menuitem", { name: "Row" });
    for (const key of ["Escape", "n", "y"]) fireEvent.keyDown(row, { key });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onSubmit).toHaveBeenCalledWith({ cancel: true });
  });
});

describe("deck menu closes when its context changes", () => {
  const next: DuelPrompt = { ...prompt, id: "p2" };

  it("closes on a new prompt", () => {
    const onSubmit = vi.fn();
    const view1 = render(<Room onSubmit={onSubmit} />);
    fireEvent.click(deck(view1.container));
    expect(screen.getByRole("menu")).toBeTruthy();
    view1.rerender(<Room onSubmit={onSubmit} current={next} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a change of turn", () => {
    const onSubmit = vi.fn();
    const view1 = render(<Room onSubmit={onSubmit} />);
    fireEvent.click(deck(view1.container));
    view1.rerender(<Room onSubmit={onSubmit} engine={view({ turnSeat: 1 })} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when the deck becomes usable, so the rows never shift under the pointer", () => {
    const onSubmit = vi.fn();
    const view1 = render(<Room onSubmit={onSubmit} />);
    fireEvent.click(deck(view1.container));
    const key = deck(view1.container).closest<HTMLElement>("[data-zones]")!.dataset.zones!;
    view1.rerender(<Room onSubmit={onSubmit} legal={[key]} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open when nothing changed", () => {
    const onSubmit = vi.fn();
    const view1 = render(<Room onSubmit={onSubmit} />);
    fireEvent.click(deck(view1.container));
    view1.rerender(<Room onSubmit={onSubmit} />);
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});
