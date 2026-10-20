// @vitest-environment jsdom
import React, { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const props = (text: string, onQueryChange = vi.fn()) => ({ query: { ...emptyCardQuery(), text }, onQueryChange,
  archetypes: [], limits: null, view: "grid" as const, onViewChange: vi.fn(), deckCount: () => 0, inspectCode: null, onInspect: vi.fn(),
  onHover: vi.fn(), onAdd: vi.fn(), onCatalog: vi.fn(), onRemoveDrop: vi.fn(), searchRef: createRef<HTMLInputElement>() });

it("offers each relax hint as a button that omits that reading chip", async () => {
  api.query.mockResolvedValue({ cards: [], total: 0, offset: 0, effectSearchEnabled: true, reading: { chips: ["Role: hand trap", "Does: banish"] },
    effectHits: [], effectTotal: 0, relax: [{ chip: "Does: banish", count: 12 }] });
  const onQueryChange = vi.fn();
  render(<CardBrowser {...props("hand trap that banishes", onQueryChange)} />);
  fireEvent.click(await screen.findByRole("button", { name: /Remove Does: banish/ }));
  expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ effectOmit: ["Does: banish"] }));
  expect(screen.getByText(/12 cards/)).toBeVisible();
});

it("heads a similar-card search with the card name and one muted reason line per hit", async () => {
  api.query.mockResolvedValue({ cards: [], total: 0, offset: 0, effectSearchEnabled: true,
    reading: { chips: ["Like: Ash Blossom"], query: { intent: { kind: "similar", passcode: 14558127, name: "Ash Blossom & Joyous Spring" } } },
    effectHits: [{ code: 1, name: "Maxx C", type: 33, level: 2, attribute: 1, race: 1, attack: 500, defense: 200, altArtCount: 0, release: { ocgDate: "2026-12", date: "2026-12", region: "ocg", upcoming: true }, score: 1, reason: "Similar hand trap to Ash Blossom & Joyous Spring" }], effectTotal: 1 });
  render(<CardBrowser {...props("cards like Ash Blossom")} />);
  expect(await screen.findByRole("heading", { name: "Cards like Ash Blossom & Joyous Spring" })).toBeVisible();
  expect(screen.getByText("Similar hand trap to Ash Blossom & Joyous Spring")).toHaveAttribute("title", "Similar hand trap to Ash Blossom & Joyous Spring");
  expect(screen.getByText("Upcoming")).toBeVisible();
  expect(screen.getByText("OCG")).toBeVisible();
});
