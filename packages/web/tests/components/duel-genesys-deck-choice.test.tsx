// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelDeckValidation, DuelSettings, SavedDeck } from "@yugidraft/shared/duels";
import { DeckEditor } from "../../src/components/duel/deck-editor";

const { listSavedDecks, getDuelCards } = vi.hoisted(() => ({ listSavedDecks: vi.fn(), getDuelCards: vi.fn() }));

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("../../src/components/decks/api", () => ({ listSavedDecks, createSavedDeck: vi.fn(), prepareDeckTextImport: vi.fn() }));
vi.mock("../../src/components/duel/api", () => ({
  validateDuelDeck: vi.fn(async () => ({ issues: [] }) as unknown as DuelDeckValidation),
  searchDuelCards: vi.fn(async () => ({ cards: [] })),
  getDuelCards,
}));

const info = (code: number, name: string, genesysPoints: number | null, type = 0x1): DuelCardInfo =>
  ({ code, name, type, genesysPoints } as unknown as DuelCardInfo);

const CARDS = [info(10, "Light", 10), info(20, "Heavy", 30), info(30, "Linker", 0, 0x4000001)];

function saved(id: number, name: string, main: number[], extra: number[] = []): SavedDeck {
  return { id, name, mode: "normal", deck: { main, extra, side: [] }, createdAt: "", updatedAt: "" };
}

const settings = (pointCap: number) => ({ validateDeck: true, genesys: { pointCap } }) as DuelSettings;
const editor = (pointCap: number) => <DeckEditor slug="t" mode="normal" settings={settings(pointCap)} initial={null} busy={false} onReady={vi.fn()} />;

describe("deck choice in a Genesys room", () => {
  beforeEach(() => {
    getDuelCards.mockImplementation(async (codes: number[]) => ({
      cards: CARDS.filter((card) => codes.includes(card.code)),
      missing: codes.filter((code) => !CARDS.some((card) => card.code === code)),
    }));
    listSavedDecks.mockResolvedValue([
      saved(1, "Fits", [10, 10]),
      saved(2, "Too heavy", [20, 20, 20, 20]),
      saved(3, "Has link", [10], [30]),
      saved(4, "Mystery", [10, 99]),
    ]);
  });
  afterEach(() => vi.clearAllMocks());

  const row = (name: string) => screen.getAllByTestId("genesys-deck-row").find((el) => within(el).queryByText(name))!;

  it("shows points and state per deck and disables decks that do not fit", async () => {
    render(editor(100));
    await waitFor(() => expect(within(row("Too heavy")).getByText("Over cap by 20")).toBeTruthy());
    expect(screen.getByText(/Genesys: each card has points\./)).toBeTruthy();
    expect(within(row("Fits")).getByText("Valid")).toBeTruthy();
    expect(within(row("Fits")).getByText("20")).toBeTruthy();
    expect(within(row("Has link")).getByText("Has Link or Pendulum")).toBeTruthy();
    expect(within(row("Mystery")).getByText("Unknown points")).toBeTruthy();
    const radio = (name: string) => within(row(name)).getByRole("radio") as HTMLInputElement;
    expect(radio("Fits").disabled).toBe(false);
    expect(radio("Too heavy").disabled).toBe(true);
    expect(radio("Has link").disabled).toBe(true);
    expect(radio("Mystery").disabled).toBe(true);
    // The reason is on the screen and linked to the radio for screen readers.
    expect(within(row("Too heavy")).getByText(/20 points over the cap of 100/)).toBeTruthy();
  });

  it("makes a deck pickable when the host raises the cap", async () => {
    const { rerender } = render(editor(100));
    await waitFor(() => expect(within(row("Too heavy")).getByText("Over cap by 20")).toBeTruthy());
    rerender(editor(120));
    expect((within(row("Too heavy")).getByRole("radio") as HTMLInputElement).disabled).toBe(false);
    expect(within(row("Too heavy")).getByText("Valid")).toBeTruthy();
    fireEvent.click(within(row("Too heavy")).getByRole("radio"));
    expect((within(row("Too heavy")).getByRole("radio") as HTMLInputElement).checked).toBe(true);
  });
});
