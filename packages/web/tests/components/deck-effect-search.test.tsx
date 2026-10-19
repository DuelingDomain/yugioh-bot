// @vitest-environment jsdom
import React, { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { emptyCardQuery } from "@yugidraft/shared/duels";
import { CardBrowser } from "../../src/components/decks/card-browser";

const api = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/components/decks/api", async original => ({ ...await original<typeof import("../../src/components/decks/api")>(), queryDeckCards: api.query }));

it.each([0, 2])("includes effect matches in the search count with %s literal matches", async total => {
  api.query.mockResolvedValue({ cards: [], total, offset: 0, effectSearchEnabled: true,
    reading: { chips: ["Role: hand trap"] }, effectHits: [], effectTotal: 183 });
  render(<CardBrowser query={{ ...emptyCardQuery(), text: "hand trap" }}
    onQueryChange={vi.fn()} archetypes={[]} limits={null} view="grid" onViewChange={vi.fn()}
    deckCount={() => 0} inspectCode={null} onInspect={vi.fn()} onHover={vi.fn()} onAdd={vi.fn()}
    onCatalog={vi.fn()} onRemoveDrop={vi.fn()} searchRef={createRef<HTMLInputElement>()} />);
  await waitFor(() => expect(screen.getByText(`${183 + total} cards`)).toBeVisible());
});
