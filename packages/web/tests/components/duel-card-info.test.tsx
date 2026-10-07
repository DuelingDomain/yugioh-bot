// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import fixture from "../../../duel-server/tests/support/fixtures/red-eyes-exceed-cards.json";

const cards: DeckCardInfo[] = fixture.texts.map((row, index) => ({
  code: Number(row[0]), name: String(row[1]), description: String(row[2]),
  type: fixture.datas[index][4], attack: fixture.datas[index][5], defense: fixture.datas[index][6],
  level: fixture.datas[index][7], attribute: fixture.datas[index][9], race: index === 0 ? "Dragon" : "unknown",
  alias: 0, setcodes: [], lscale: 0, rscale: 0, arrows: 0, ot: 1,
}));
const fetchCards = vi.fn();
beforeEach(() => {
  vi.resetModules(); fetchCards.mockReset();
  fetchCards.mockImplementation(async (_url: string, init?: RequestInit) => {
    // The old name-search endpoint does not know these passcodes.
    if (init?.method !== "POST") return Response.json({ cards: [] });
    const { codes } = JSON.parse(String(init.body)) as { codes: number[] };
    return Response.json({ cards: cards.filter(card => codes.includes(card.code)), missing: [] });
  });
  vi.stubGlobal("fetch", fetchCards);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(cards)("renders $name and its entire multiline text from the exact metadata lookup", async card => {
  const { DeckCardPreview } = await import("../../src/components/duel/deck-card-preview");
  const { container } = render(<DeckCardPreview code={card.code} />);
  await screen.findByRole("heading", { name: card.name });
  expect([...container.querySelectorAll("p")].some(p => p.textContent === card.description.trim())).toBe(true);
  expect(fetchCards).toHaveBeenCalledWith("/api/duels/cards", expect.objectContaining({
    method: "POST", body: JSON.stringify({ codes: [card.code] }),
  }));
});

it("retries a previously missing passcode when it is inspected again after a bundle update", async () => {
  const card = cards[0];
  fetchCards.mockResolvedValueOnce(Response.json({ cards: [], missing: [card.code] }));
  const { DeckCardPreview } = await import("../../src/components/duel/deck-card-preview");
  const first = render(<DeckCardPreview code={card.code} />);
  await screen.findByRole("heading", { name: `Card ${card.code}` });
  first.unmount();
  render(<DeckCardPreview code={card.code} />);
  await screen.findByRole("heading", { name: card.name });
  expect(fetchCards).toHaveBeenCalledTimes(2);
});

it("retries transient lookup errors on a later inspection", async () => {
  const card = cards[0];
  fetchCards.mockResolvedValueOnce(Response.json({ error: "Restarting" }, { status: 503 }));
  const { DeckCardPreview } = await import("../../src/components/duel/deck-card-preview");
  const first = render(<DeckCardPreview code={card.code} />);
  await screen.findByRole("heading", { name: `Card ${card.code}` });
  first.unmount();
  render(<DeckCardPreview code={card.code} />);
  await screen.findByRole("heading", { name: card.name });
  expect(fetchCards).toHaveBeenCalledTimes(2);
});

it("caches named tokens with an empty description across inspections", async () => {
  const card = { ...cards[0], name: "Token", description: "" };
  fetchCards.mockResolvedValueOnce(Response.json({ cards: [card], missing: [] }));
  const { DeckCardPreview } = await import("../../src/components/duel/deck-card-preview");
  const first = render(<DeckCardPreview code={card.code} />);
  await screen.findByRole("heading", { name: card.name });
  first.unmount();
  render(<DeckCardPreview code={card.code} />);
  await screen.findByRole("heading", { name: card.name });
  expect(fetchCards).toHaveBeenCalledTimes(1);
});

it.each([`Card ${cards[0].code}`, "", "  "])("retries a response with the placeholder or blank name %j", async name => {
  const card = cards[0];
  fetchCards.mockResolvedValueOnce(Response.json({ cards: [{ ...card, name }], missing: [] }));
  const { loadDuelCardInfo } = await import("../../src/components/duel/card-info");
  expect(await loadDuelCardInfo(card.code)).toMatchObject({ name });
  expect(await loadDuelCardInfo(card.code)).toMatchObject(card);
  expect(fetchCards).toHaveBeenCalledTimes(2);
});

it("does not let a late hover lookup overwrite the current card", async () => {
  let finish!: (response: Response) => void;
  fetchCards.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  const { DeckCardPreview } = await import("../../src/components/duel/deck-card-preview");
  const { rerender } = render(<DeckCardPreview code={cards[0].code} />);
  rerender(<DeckCardPreview code={cards[1].code} />);
  await screen.findByRole("heading", { name: cards[1].name });
  await act(async () => { finish(Response.json({ cards: [cards[0]], missing: [] })); });
  expect(screen.getByRole("heading", { name: cards[1].name })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: cards[0].name })).not.toBeInTheDocument();
});

it("fills missing field-preview text through the same lookup while retaining live combat stats", async () => {
  const card = cards[0];
  const { CardInspector } = await import("../../src/components/duel/inspector");
  const { container } = render(<CardInspector target={{ type: "card", card: {
    code: card.code, name: `Card ${card.code}`, description: "", attack: 5100, defense: 3000,
    type: undefined, canonicalPasscode: undefined,
    controller: 0, location: 4, sequence: 0, position: 1,
  } }} />);
  await screen.findByRole("heading", { name: card.name });
  expect([...container.querySelectorAll("p")].some(p => p.textContent === card.description)).toBe(true);
  expect(screen.getByText(/5100/)).toBeInTheDocument();
  expect(screen.getByText("Dragon / Fusion Effect")).toBeInTheDocument();
});

it("does not fetch or reveal hidden cards", async () => {
  const { CardInspector } = await import("../../src/components/duel/inspector");
  render(<CardInspector target={{ type: "card", card: { controller: 1, location: 4, sequence: 0, position: 8 } }} />);
  expect(screen.getByText("Face-down card.")).toBeInTheDocument();
  expect(fetchCards).not.toHaveBeenCalled();
});

it("uses complete live field text without an extra lookup", async () => {
  const { CardInspector } = await import("../../src/components/duel/inspector");
  render(<CardInspector target={{ type: "info", card: cards[1] }} />);
  expect(screen.getByRole("heading", { name: cards[1].name })).toBeInTheDocument();
  expect(fetchCards).not.toHaveBeenCalled();
});

it("deduplicates concurrent previews of the same passcode", async () => {
  const { DeckCardPreview } = await import("../../src/components/duel/deck-card-preview");
  render(<><DeckCardPreview code={cards[0].code} /><DeckCardPreview code={cards[0].code} /></>);
  await waitFor(() => expect(screen.getAllByRole("heading", { name: cards[0].name })).toHaveLength(2));
  expect(fetchCards).toHaveBeenCalledTimes(1);
});

it("renders the same full text in the saved deck builder's card preview", async () => {
  const { CardPreview } = await import("../../src/components/decks/card-preview");
  const { container } = render(<CardPreview card={cards[1]} />);
  expect(screen.getByRole("heading", { name: cards[1].name })).toBeInTheDocument();
  expect([...container.querySelectorAll("p")].some(p => p.textContent === cards[1].description)).toBe(true);
});
