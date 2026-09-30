import type { CardFacets, CardQuery, CardQueryResult, DeckCardInfo, DuelDeck, DuelMode, SavedDeck } from "@yugidraft/shared/duels";

export type { SavedDeck };

export class DeckRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DeckRequestError";
    this.status = status;
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return `Request failed (${status})`;
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.redirected) {
    throw new DeckRequestError("Your session expired. Sign in again to open your decks.", 401);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new DeckRequestError(errorMessage(body, res.status), res.status);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DeckRequestError("The server returned an invalid response.", 502);
  }
  return body as T;
}

function readDeck(body: { deck?: SavedDeck }): SavedDeck {
  if (!body.deck || typeof body.deck !== "object") {
    throw new DeckRequestError("The server returned an invalid deck.", 502);
  }
  return body.deck;
}

export async function listSavedDecks(): Promise<SavedDeck[]> {
  const body = await parseBody<{ decks?: SavedDeck[] }>(await fetch("/api/decks", { cache: "no-store" }));
  if (!Array.isArray(body.decks)) {
    throw new DeckRequestError("The server returned an invalid deck list.", 502);
  }
  return body.decks;
}

export async function getSavedDeck(id: number): Promise<SavedDeck> {
  return readDeck(await parseBody(await fetch(`/api/decks/${id}`, { cache: "no-store" })));
}

export async function createSavedDeck(input: {
  name: string;
  mode: DuelMode;
  deck: DuelDeck;
}): Promise<SavedDeck> {
  return readDeck(await parseBody(await fetch("/api/decks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })));
}

export async function updateSavedDeck(
  id: number,
  input: { name: string; mode: DuelMode; deck: DuelDeck },
): Promise<SavedDeck> {
  return readDeck(await parseBody(await fetch(`/api/decks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })));
}

export async function deleteSavedDeck(id: number): Promise<void> {
  await parseBody<{ ok?: boolean }>(await fetch(`/api/decks/${id}`, { method: "DELETE" }));
}

export async function queryDeckCards(query: CardQuery, signal?: AbortSignal): Promise<CardQueryResult> {
  const body = await parseBody<Partial<CardQueryResult>>(await fetch("/api/decks/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
    signal,
  }));
  if (!Array.isArray(body.cards) || typeof body.total !== "number") {
    throw new DeckRequestError("The server returned an invalid card list.", 502);
  }
  return { cards: body.cards, total: body.total, offset: body.offset ?? query.offset };
}

export async function getDeckCardFacets(): Promise<CardFacets> {
  const body = await parseBody<Partial<CardFacets>>(await fetch("/api/decks/cards/facets"));
  return { archetypes: body.archetypes ?? [], banlists: body.banlists ?? {} };
}

export async function getDeckCards(codes: number[]): Promise<{ cards: DeckCardInfo[]; missing: number[] }> {
  const body = await parseBody<{ cards?: DeckCardInfo[]; missing?: number[] }>(await fetch("/api/duels/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes }),
  }));
  return { cards: body.cards ?? [], missing: body.missing ?? [] };
}
