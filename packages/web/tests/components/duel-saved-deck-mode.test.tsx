// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelDeckValidation, DuelMode, DuelSettings, SavedDeck } from "@yugidraft/shared/duels";
import { DeckEditor } from "../../src/components/duel/deck-editor";

const { listSavedDecks } = vi.hoisted(() => ({ listSavedDecks: vi.fn() }));

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("../../src/components/decks/api", () => ({ listSavedDecks }));
vi.mock("../../src/components/duel/api", () => ({
  validateDuelDeck: vi.fn(async () => ({ issues: [] }) as unknown as DuelDeckValidation),
  searchDuelCards: vi.fn(async () => ({ cards: [] })),
}));

function saved(id: number, name: string, mode: DuelMode, main: number[]): SavedDeck {
  return { id, name, mode, deck: { main, extra: [], side: [] }, createdAt: "", updatedAt: "" };
}

function renderEditor(mode: DuelMode, validateDeck: boolean) {
  render(<DeckEditor slug="table-1" mode={mode} settings={{ validateDeck } as DuelSettings} initial={null} busy={false} onReady={vi.fn()} />);
}

async function picker() {
  const select = screen.getByLabelText("Use a saved deck") as HTMLSelectElement;
  await waitFor(() => expect(select).not.toBeDisabled());
  return select;
}

function optionNames(): string[] {
  const select = screen.getByLabelText("Use a saved deck") as HTMLSelectElement;
  return Array.from(select.options, (entry) => entry.textContent ?? "");
}

describe("saved deck picker and the table's format", () => {
  beforeEach(() => {
    listSavedDecks.mockResolvedValue([
      saved(1, "Blue-Eyes DOMAIN", "normal", [111, 112]),
      saved(2, "Real Domain", "domain", [221]),
      saved(3, "Plain Normal", "normal", [331]),
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["checked", true],
    ["custom", false],
  ])("lists only Domain decks at a %s Domain table", async (_label, validateDeck) => {
    renderEditor("domain", validateDeck);
    const select = await picker();

    expect(optionNames()).toEqual(["Choose a deck", "Real Domain · 1 Main / 0 Extra / 0 Side"]);
    fireEvent.change(select, { target: { value: select.options[1]!.value } });
    expect(screen.getByRole("button", { name: "Remove 221 from Main" })).toBeInTheDocument();
  });

  it.each([
    ["checked", true],
    ["custom", false],
  ])("lists only Standard decks at a %s Standard table", async (_label, validateDeck) => {
    renderEditor("normal", validateDeck);
    await picker();

    expect(optionNames()).toEqual([
      "Choose a deck",
      "Blue-Eyes DOMAIN · 2 Main / 0 Extra / 0 Side",
      "Plain Normal · 1 Main / 0 Extra / 0 Side",
    ]);
  });

  it("says how to get a Domain deck when none is saved as Domain, even at a custom table", async () => {
    listSavedDecks.mockResolvedValue([saved(1, "Blue-Eyes DOMAIN", "normal", [111])]);
    renderEditor("domain", false);
    await picker();

    expect(optionNames()).toEqual(["No saved Domain decks"]);
    expect(screen.getByText(/save a deck as Domain/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage decks" })).toHaveAttribute("href", "/decks");
  });

  it("keeps the empty message when no deck is saved", async () => {
    listSavedDecks.mockResolvedValue([]);
    renderEditor("normal", true);
    await picker();

    expect(optionNames()).toEqual(["No saved Standard decks"]);
  });
});
