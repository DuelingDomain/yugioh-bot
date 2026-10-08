import type { CardAdmissionContext } from "@/lib/card-admission-context";
import type { DraftDeckPool } from "./pool-model";
import type { CardFacets, CardQuery, CardQueryResult, DeckArtworkSwapRequest, DeckCardInfo, DuelDeck, DuelMode, SavedDeck } from "@yugidraft/shared/duels";
import type { DeckRegistrationMark } from "@yugidraft/shared/services";

export type { SavedDeck, DeckRegistrationMark };

/** A saved deck as the decks API returns it: the stored deck plus the tournament it is registered for, if any. */
export type SavedDeckView = SavedDeck & { registration?: DeckRegistrationMark | null };

export class DeckRequestError extends Error {
  readonly status: number;
  /** The caller's existing deck, when a 409 says a deck for this draft exists. */
  readonly deckId?: number;

  constructor(message: string, status: number, deckId?: number) {
    super(message);
    this.name = "DeckRequestError";
    this.status = status;
    this.deckId = deckId;
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
    const deckId = body && typeof body === "object" && "deckId" in body && typeof body.deckId === "number" ? body.deckId : undefined;
    throw new DeckRequestError(errorMessage(body, res.status), res.status, deckId);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DeckRequestError("The server returned an invalid response.", 502);
  }
  return body as T;
}

function readDeck(body: { deck?: SavedDeckView }): SavedDeckView {
  if (!body.deck || typeof body.deck !== "object") {
    throw new DeckRequestError("The server returned an invalid deck.", 502);
  }
  return body.deck;
}

export async function listSavedDecks(): Promise<SavedDeckView[]> {
  const body = await parseBody<{ decks?: SavedDeckView[] }>(await fetch("/api/decks", { cache: "no-store" }));
  if (!Array.isArray(body.decks)) {
    throw new DeckRequestError("The server returned an invalid deck list.", 502);
  }
  return body.decks;
}

export async function getSavedDeck(id: number): Promise<SavedDeckView> {
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
): Promise<SavedDeckView> {
  return readDeck(await parseBody(await fetch(`/api/decks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })));
}

/** A saved draft deck and, when the tournament registration failed, why. */
export type DraftDeckSave = { deck: SavedDeckView; warning?: string };

function readDraftSave(body: { deck?: SavedDeckView; warning?: unknown }): DraftDeckSave {
  const deck = readDeck(body);
  return typeof body.warning === "string" && body.warning ? { deck, warning: body.warning } : { deck };
}

/**
 * Saves the player's deck for a draft. One deck exists per draft, so a create that finds one
 * (409 with its id) continues as an update of that deck.
 */
export async function saveDraftDeck(
  existingId: number | null,
  input: { name: string; mode: DuelMode; deck: DuelDeck; draftId: number },
): Promise<DraftDeckSave> {
  const send = async (id: number | null) => readDraftSave(await parseBody(await fetch(id == null ? "/api/decks" : `/api/decks/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })));
  try {
    return await send(existingId);
  } catch (error) {
    if (existingId == null && error instanceof DeckRequestError && error.status === 409 && error.deckId != null) {
      return send(error.deckId);
    }
    throw error;
  }
}

/** Reads the `registration` the API sends next to a deck; anything that is not a full mark counts as none. */
export function readRegistration(value: unknown): DeckRegistrationMark | null {
  if (!value || typeof value !== "object") return null;
  const { tournament, locked } = value as { tournament?: unknown; locked?: unknown };
  if (!tournament || typeof tournament !== "object") return null;
  const t = tournament as Record<string, unknown>;
  if (typeof t.id !== "number" || typeof t.name !== "string" || typeof t.status !== "string") return null;
  return {
    tournament: { id: t.id, slug: typeof t.slug === "string" ? t.slug : null, name: t.name, status: t.status },
    locked: locked === true,
  };
}

/** The caller's pool for a finished draft, as engine passcodes. */
export async function getDraftDeckPool(slug: string): Promise<Omit<DraftDeckPool, "slug">> {
  const body = await parseBody<Partial<Omit<DraftDeckPool, "slug">> & { unresolved?: number[] }>(
    await fetch(`/api/drafts/${encodeURIComponent(slug)}/deck-pool`, { cache: "no-store" }),
  );
  if (typeof body.draftId !== "number" || !Array.isArray(body.cards) || typeof body.mainPoolCount !== "number") {
    throw new DeckRequestError("The server returned an invalid draft pool.", 502);
  }
  return {
    draftId: body.draftId,
    draftName: typeof body.draftName === "string" ? body.draftName : "Draft",
    cards: body.cards,
    forcedCopies: body.forcedCopies && typeof body.forcedCopies === "object" ? body.forcedCopies : {},
    mainPoolCount: body.mainPoolCount,
    unresolved: Array.isArray(body.unresolved) ? body.unresolved : [],
    savedDeckId: typeof body.savedDeckId === "number" ? body.savedDeckId : null,
    registration: readRegistration(body.registration),
  };
}

export async function deleteSavedDeck(id: number): Promise<void> {
  await parseBody<{ ok?: boolean }>(await fetch(`/api/decks/${id}`, { method: "DELETE" }));
}

export async function queryDeckCards(query: CardQuery, signal?: AbortSignal, context: CardAdmissionContext = {}): Promise<CardQueryResult> {
  const body = await parseBody<Partial<CardQueryResult>>(await fetch("/api/decks/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...query, ...context }),
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

export async function getDeckCards(codes: number[], context: CardAdmissionContext = {}): Promise<{ cards: DeckCardInfo[]; missing: number[] }> {
  const body = await parseBody<{ cards?: DeckCardInfo[]; missing?: number[] }>(await fetch("/api/duels/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes, ...context }),
  }));
  return { cards: body.cards ?? [], missing: body.missing ?? [] };
}

/** Swap one deck occurrence to another art of the same card. The server only checks and rebuilds the deck; saving is separate. */
export async function swapDeckArtwork(request: DeckArtworkSwapRequest, signal?: AbortSignal): Promise<DuelDeck> {
  const body = await parseBody<{ deck?: DuelDeck }>(await fetch("/api/decks/artwork", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  }));
  if (!body.deck) throw new DeckRequestError("The server returned no deck.", 502);
  return body.deck;
}
