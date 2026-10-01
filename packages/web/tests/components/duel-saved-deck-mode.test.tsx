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

function option(name: RegExp) {
  return screen.getByRole("option", { name }) as HTMLOptionElement;
}

describe("saved deck picker and the table's format", () => {
  beforeEach(() => {
    // The deck a player built as a Domain list but saved under Normal, and one saved as Domain.
    listSavedDecks.mockResolvedValue([
      saved(1, "Blue-Eyes DOMAIN", "normal", [111, 112]),
      saved(2, "Real Domain", "domain", [221]),
      saved(3, "Plain Normal", "normal", [331]),
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists every saved deck at a custom Domain table, because the format check is off", async () => {
    renderEditor("domain", false);
    const select = await picker();

    for (const name of [/^Blue-Eyes DOMAIN ·/, /^Real Domain ·/, /^Plain Normal ·/]) {
      expect(option(name)).toBeEnabled();
    }
    fireEvent.change(select, { target: { value: option(/^Blue-Eyes DOMAIN ·/).value } });

    expect(screen.getByRole("button", { name: "Remove 111 from Main" })).toBeInTheDocument();
  });

  it("lists every saved deck at a custom Normal table", async () => {
    renderEditor("normal", false);
    await picker();

    expect(option(/^Real Domain ·/)).toBeEnabled();
    expect(option(/^Plain Normal ·/)).toBeEnabled();
  });

  it("offers only matching decks at a checked Domain table and says why the others cannot be used", async () => {
    renderEditor("domain", true);
    await picker();

    expect(option(/^Real Domain ·/)).toBeEnabled();
    const blocked = option(/^Blue-Eyes DOMAIN ·/);
    expect(blocked).toBeDisabled();
    expect(blocked.textContent).toMatch(/saved as Normal/i);
    expect(option(/^Plain Normal ·/)).toBeDisabled();
  });

  it("offers only matching decks at a checked Normal table", async () => {
    renderEditor("normal", true);
    await picker();

    expect(option(/^Plain Normal ·/)).toBeEnabled();
    expect(option(/^Blue-Eyes DOMAIN ·/)).toBeEnabled();
    const blocked = option(/^Real Domain ·/);
    expect(blocked).toBeDisabled();
    expect(blocked.textContent).toMatch(/saved as Domain/i);
  });

  it("keeps the empty message when no deck is saved", async () => {
    listSavedDecks.mockResolvedValue([]);
    renderEditor("domain", false);
    await picker();

    expect(option(/No saved decks/)).toBeInTheDocument();
  });
});
