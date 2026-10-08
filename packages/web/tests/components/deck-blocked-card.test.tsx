// @vitest-environment jsdom
import React from "react";
import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyCardQuery, type DeckCardInfo } from "@yugidraft/shared/duels";
import { CardBrowser } from "../../src/components/decks/card-browser";
import { CardActions } from "../../src/components/decks/card-actions";
import { cardAddBlock } from "../../src/components/duel/card-add-search";

const api = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/components/decks/api", async original => ({ ...await original<typeof import("../../src/components/decks/api")>(), queryDeckCards: api.query }));

const reason = "Repeated script failure under investigation";
const card: DeckCardInfo = {
  code: 10, name: "Blocked Dragon", type: 17, description: "", attack: 1000, defense: 1000,
  level: 4, attribute: 1, race: "Dragon", alias: 0, setcodes: [], lscale: 0, rscale: 0, arrows: 0,
  ot: 3, unavailableReason: reason,
};

describe("blocked cards in the deck builder", () => {
  it.each(["list", "grid"] as const)("marks a %s result unavailable and prevents add shortcuts and drag", (view) => {
    const onAdd = vi.fn();
    render(<CardBrowser pool={{ cards: [card], remaining: () => 1 }} query={emptyCardQuery()}
      onQueryChange={vi.fn()} archetypes={[]} limits={null} view={view} onViewChange={vi.fn()}
      deckCount={() => 0} inspectCode={null} onInspect={vi.fn()} onHover={vi.fn()} onAdd={onAdd}
      onCatalog={vi.fn()} onRemoveDrop={vi.fn()} searchRef={createRef<HTMLInputElement>()} />);
    const tile = screen.getByRole("button", { name: /Blocked Dragon.*Unavailable/i });
    expect(tile).toHaveAttribute("draggable", "false");
    expect(tile).toHaveAttribute("title", expect.stringContaining(reason));
    expect(screen.getByText(/Unavailable/)).toBeVisible();
    fireEvent.doubleClick(tile);
    fireEvent.contextMenu(tile);
    fireEvent.keyDown(tile, { key: "+" });
    expect(onAdd).not.toHaveBeenCalled();
    if (view === "list") expect(screen.getByRole("button", { name: "Add Blocked Dragon to the deck" })).toBeDisabled();
  });

  it("shows the reason and disables add and Deck Master controls while allowing removal", () => {
    render(<CardActions card={card} deck={{ main: [10], extra: [], side: [] }} mode="domain"
      copies={1} limit={3} banlistName={null} archetypes={[]} onAdd={vi.fn()} onRemove={vi.fn()}
      onMaster={vi.fn()} onArchetype={vi.fn()} />);
    expect(screen.getByText(`Unavailable: ${reason}`)).toBeVisible();
    expect(screen.getByRole("button", { name: "Add one Blocked Dragon to Main" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add one Blocked Dragon to Side" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use as Deck Master" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove one Blocked Dragon from Main" })).toBeEnabled();
  });

  it("blocks the room's Add card field even when competitive validation is off", () => {
    expect(cardAddBlock(card, { cardPool: "both", validateDeck: false })).toBe(`Unavailable: ${reason}`);
  });
});

it("refetches browser availability when switching from Normal to Domain", async () => {
  api.query.mockImplementation(async (_query, _signal, context) => ({ cards: [context.mode === "normal" ? card : { ...card, unavailableReason: undefined }], total: 1, offset: 0 }));
  const onAdd = vi.fn();
  const props = { query: emptyCardQuery(), onQueryChange: vi.fn(), archetypes: [], limits: null, view: "grid" as const,
    onViewChange: vi.fn(), deckCount: () => 0, inspectCode: null, onInspect: vi.fn(), onHover: vi.fn(), onAdd,
    onCatalog: vi.fn(), onRemoveDrop: vi.fn(), searchRef: createRef<HTMLInputElement>() };
  const { rerender } = render(<CardBrowser {...props} mode="normal" />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Blocked Dragon.*Unavailable/i })).toBeVisible());
  rerender(<CardBrowser {...props} mode="domain" />);
  await waitFor(() => expect(api.query).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { mode: "domain" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Blocked Dragon/i })).not.toHaveAttribute("title", expect.stringContaining("Unavailable")));
  fireEvent.doubleClick(screen.getByRole("button", { name: /Blocked Dragon/i }));
  expect(onAdd).toHaveBeenCalled();
});
