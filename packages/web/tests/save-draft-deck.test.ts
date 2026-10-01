import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckRequestError, saveDraftDeck } from "../src/components/decks/api";

const input = {
  name: "Mine",
  mode: "normal" as const,
  deck: { main: [1], extra: [], side: [] },
  draftId: 3,
};
const saved = { id: 9, name: "Mine", mode: "normal", deck: input.deck, draftId: 3 };

afterEach(() => vi.unstubAllGlobals());

describe("saveDraftDeck", () => {
  it("continues as an update when the create answers 409 with the existing deck id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "You already have a deck for this draft", deckId: 9 }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ deck: saved }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveDraftDeck(null, input);
    expect(result.deck.id).toBe(9);
    expect(fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual(["POST /api/decks", "PUT /api/decks/9"]);
  });

  it("fails on a 409 that carries no deck id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "busy" }, { status: 409 })));
    await expect(saveDraftDeck(null, input)).rejects.toBeInstanceOf(DeckRequestError);
  });
});
