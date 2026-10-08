// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelDeckValidation, DuelSettings, SavedDeck } from "@yugidraft/shared/duels";
import { DeckEditor } from "../../src/components/duel/deck-editor";

const { listSavedDecks, createSavedDeck } = vi.hoisted(() => ({ listSavedDecks: vi.fn(), createSavedDeck: vi.fn() }));

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("../../src/components/decks/api", () => ({ listSavedDecks, createSavedDeck }));
vi.mock("../../src/components/duel/api", () => ({
  validateDuelDeck: vi.fn(async () => ({ issues: [] }) as unknown as DuelDeckValidation),
  searchDuelCards: vi.fn(async () => ({ cards: [] })),
}));

function saved(id: number, name: string, main: number[], mode: SavedDeck["mode"] = "normal"): SavedDeck {
  return { id, name, mode, deck: { main, extra: [], side: [] }, createdAt: "", updatedAt: "" };
}

const settings = { validateDeck: true } as DuelSettings;

function renderEditor(mode: "normal" | "domain" = "normal") {
  render(<DeckEditor slug="table-1" mode={mode} settings={settings} initial={null} busy={false} onReady={vi.fn()} />);
}

function importFile(name: string, text: string) {
  const input = screen.getByLabelText("YDK file");
  fireEvent.change(input, { target: { files: [new File([text], name, { type: "text/plain" })] } });
}

const YDK = "#main\n111\n112\n#extra\n!side\n";

describe("saving an imported deck to My Decks", () => {
  beforeEach(() => {
    listSavedDecks.mockResolvedValue([saved(1, "Alpha", [221])]);
    createSavedDeck.mockImplementation(async (input: { name: string; mode: SavedDeck["mode"]; deck: SavedDeck["deck"] }) => (
      { id: 9, name: input.name, mode: input.mode, deck: input.deck, createdAt: "", updatedAt: "" }
    ));
  });
  afterEach(() => vi.clearAllMocks());

  it("saves a file under its name without .ydk and lists it at once", async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByLabelText("Use a saved deck")).not.toBeDisabled());
    importFile("Red Eyes.ydk", YDK);

    expect(await screen.findByText("Saved to your decks as Red Eyes")).toBeInTheDocument();
    expect(createSavedDeck).toHaveBeenCalledWith({ name: "Red Eyes", mode: "normal", deck: { main: [111, 112], extra: [], side: [] } });
    expect(screen.getByRole("option", { name: /^Red Eyes ·/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove 111 from Main" })).toBeInTheDocument();
  });

  it("names a paste Imported deck with the date and time", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Paste YDK or YDKE"), { target: { value: YDK } });
    fireEvent.click(screen.getByRole("button", { name: "Load paste" }));

    await waitFor(() => expect(createSavedDeck).toHaveBeenCalledOnce());
    expect(createSavedDeck.mock.calls[0][0].name).toMatch(/^Imported deck \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("adds (2) when the name is used", async () => {
    listSavedDecks.mockResolvedValue([saved(1, "Red Eyes", [221])]);
    renderEditor();
    await waitFor(() => expect(screen.getByLabelText("Use a saved deck")).not.toBeDisabled());
    importFile("Red Eyes.ydk", YDK);

    expect(await screen.findByText("Saved to your decks as Red Eyes (2)")).toBeInTheDocument();
  });

  it("does not save the same cards twice", async () => {
    listSavedDecks.mockResolvedValue([saved(1, "Alpha", [112, 111])]);
    renderEditor();
    await waitFor(() => expect(screen.getByLabelText("Use a saved deck")).not.toBeDisabled());
    importFile("Copy.ydk", YDK);

    expect(await screen.findByText("Already in your decks: Alpha")).toBeInTheDocument();
    expect(createSavedDeck).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove 111 from Main" })).toBeInTheDocument();
  });

  it("still saves when the same cards are saved in the other format", async () => {
    listSavedDecks.mockResolvedValue([saved(1, "Alpha", [111, 112], "domain")]);
    renderEditor("normal");
    await waitFor(() => expect(screen.getByLabelText("Use a saved deck")).not.toBeDisabled());
    importFile("Copy.ydk", YDK);

    expect(await screen.findByText("Saved to your decks as Copy")).toBeInTheDocument();
  });

  it("keeps the import when the save fails", async () => {
    createSavedDeck.mockRejectedValue(new Error("Request failed (500)"));
    renderEditor();
    await waitFor(() => expect(screen.getByLabelText("Use a saved deck")).not.toBeDisabled());
    importFile("Red Eyes.ydk", YDK);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save to your decks: Request failed (500)");
    expect(screen.getByRole("button", { name: "Remove 111 from Main" })).toBeInTheDocument();
  });

  it("saves the import as given, not as the room changes it", async () => {
    renderEditor("domain");
    await waitFor(() => expect(screen.getByLabelText("Use a saved deck")).not.toBeDisabled());
    importFile("Dom.ydk", "#main\n111\n112\n#extra\n!side\n113\n");

    await waitFor(() => expect(createSavedDeck).toHaveBeenCalledOnce());
    expect(createSavedDeck.mock.calls[0][0].deck).toEqual({ main: [111, 112], extra: [], side: [113] });
    expect(createSavedDeck.mock.calls[0][0].mode).toBe("domain");
  });
});
