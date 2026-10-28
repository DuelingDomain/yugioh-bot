/*
 * Browser calls for effect search in the cube and draft screens.
 * The reading, ranking and tags are credited to LorenzoWhite/searchygo (commit 9b2d952); see NOTICE.
 * Name search does not come through here: it keeps its own request on /api/cards/resolve.
 */

import type { CardSummary } from "@/lib/card-types";
import { putCards } from "@/lib/cards-cache";
import type { ArchetypeGuide, CardEra } from "@yugidraft/shared/cards/effects";

export type EffectIntent = NonNullable<import("@yugidraft/shared/cards/effects").EffectQuery["intent"]>;

/** A card that matched a description, with the one-line reason it matched. */
export interface EffectCard extends CardSummary {
  score: number;
  reason: string;
}

export interface EffectSearchResult {
  cards: EffectCard[];
  /** How many cards match in all. `cards` holds the best of them. */
  total: number;
  /** How the text was read: one chip per part. Null when the text does not read as an effect. */
  chips: string[] | null;
  /** "How it plays" for the archetype the text names, when there is one. */
  guide?: ArchetypeGuide;
  relax?: Array<{ chip: string; count: number }>;
  /** What the text asks for beyond a filter: cards like one card, or how to beat an archetype. */
  intent?: EffectIntent;
}

/** The server says the feature is off (HTTP 404), or the request failed. */
export class EffectApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly disabled = false,
  ) {
    super(message);
    this.name = "EffectApiError";
  }
}

async function readError(res: Response, fallback: string): Promise<EffectApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; effectSearchEnabled?: boolean };
  const disabled = res.status === 404 && body.effectSearchEnabled === false;
  if (res.status === 429 || res.status === 503) {
    return new EffectApiError("The card database is busy. Try again in a moment.", res.status);
  }
  return new EffectApiError(disabled ? "Description search is off." : body.error && body.error.length < 140 ? body.error : fallback, res.status, disabled);
}

async function post<T>(url: string, body: unknown, fallback: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new EffectApiError("Could not reach the server. Check your connection and try again.", 0);
  }
  if (!res.ok) throw await readError(res, fallback);
  return (await res.json()) as T;
}

export interface EffectSearchOptions {
  /** Chips the player switched off. */
  omittedChips?: readonly string[];
  /** Match the written card text only, with no reading. */
  exact?: boolean;
  limit?: number;
  /** "newest" lists the newest cards first; "match" (the default) ranks by how well the text fits. */
  sort?: "match" | "newest";
  /** Release years the results lean toward (a cube's era). It changes the rank only, never what matches. */
  era?: CardEra;
  signal?: AbortSignal;
}

export async function effectSearch(text: string, options: EffectSearchOptions = {}): Promise<EffectSearchResult> {
  const body: Record<string, unknown> = { op: "effectSearch", text, limit: options.limit ?? 30 };
  if (options.exact) body.exact = true;
  if (options.sort === "newest") body.sort = "newest";
  if (options.era !== undefined) body.era = options.era;
  if (options.omittedChips?.length) body.omittedChips = options.omittedChips;
  const data = await post<{ cards: EffectCard[]; total: number; reading: { chips: string[]; query?: { intent?: EffectIntent } } | null; guide?: ArchetypeGuide; relax?: EffectSearchResult["relax"] }>(
    "/api/cards/resolve",
    body,
    "The description search did not work.",
    options.signal,
  );
  putCards(data.cards);
  return { cards: data.cards, total: data.total, chips: data.reading?.chips ?? null, relax: data.relax ?? [], ...(data.reading?.query?.intent ? { intent: data.reading.query.intent } : {}), ...(data.guide ? { guide: data.guide } : {}) };
}

/** The cards for one row of "How it plays": cards that are this kind ("is") or that help the deck ("support"). */
export async function hookSearch(archetype: string, hook: number, find: "is" | "support", members: boolean, options: { limit?: number; sort?: "match" | "newest"; era?: CardEra; signal?: AbortSignal } = {}): Promise<EffectCard[]> {
  const data = await post<{ cards: EffectCard[] }>(
    "/api/cards/resolve",
    {
      op: "hookSearch", archetype, hook, find, ...(members ? { members: true } : {}), limit: options.limit ?? 30,
      ...(options.sort === "newest" ? { sort: "newest" } : {}), ...(options.era !== undefined ? { era: options.era } : {}),
    },
    "The cards for this row did not load.",
    options.signal,
  );
  putCards(data.cards);
  return data.cards;
}

/* ---------- card summary (hover) ---------- */

export interface CardNote {
  summary: string | null;
  roles: string[];
}

const notes = new Map<number, Promise<CardNote>>();

/** The written summary of one card. It is fetched on first need and kept. A failed fetch is not kept. */
export function fetchCardNote(passcode: number): Promise<CardNote> {
  const known = notes.get(passcode);
  if (known) return known;
  const pending = post<{ summary: { summary: string; roles: string[] } | null }>(
    "/api/cards/insights",
    { op: "summary", passcode },
    "No summary.",
  ).then((data) => ({ summary: data.summary?.summary ?? null, roles: data.summary?.roles ?? [] }));
  notes.set(passcode, pending);
  pending.catch(() => notes.delete(passcode));
  return pending;
}

/* ---------- seed from a phrase ---------- */

export type SeedCategory = "archetype" | "phrase" | "partner" | "staple";
export type SeedRole = "searcher" | "extender" | "removal" | "hand_trap";

export interface SeedRow {
  id: number;
  name: string;
  copies: number;
  pool: "main" | "extra";
  category: SeedCategory;
  reason: string;
  roles: string[];
}

export interface SeedPreview {
  phrase: string;
  targetCount: number;
  maxCopies: number;
  era?: CardEra;
  chips: string[] | null;
  guide?: ArchetypeGuide;
  rows: SeedRow[];
  cards: CardSummary[];
  roleQuotas: Record<SeedRole, { target: number; selected: number }>;
  warnings: string[];
}

type SeedPreviewOptions = { targetCount?: number; maxCopies?: number; era?: CardEra; signal?: AbortSignal };

/** Preview against a cube, so the cards it already holds are left out. */
export function previewSeed(cubeId: number, phrase: string, options: SeedPreviewOptions = {}): Promise<SeedPreview> {
  return requestSeedPreview(`/api/cubes/${cubeId}/seed/preview`, phrase, options);
}

/** Preview a theme for a lobby. No cube exists yet; nothing is created until the host confirms. */
export function previewDraftSeed(slug: string, phrase: string, options: SeedPreviewOptions = {}): Promise<SeedPreview> {
  return requestSeedPreview(`/api/drafts/${encodeURIComponent(slug)}/seed/preview`, phrase, options);
}

async function requestSeedPreview(url: string, phrase: string, options: SeedPreviewOptions): Promise<SeedPreview> {
  const body: Record<string, unknown> = { phrase };
  if (options.targetCount !== undefined) body.targetCount = options.targetCount;
  if (options.maxCopies !== undefined) body.maxCopies = options.maxCopies;
  if (options.era !== undefined) body.era = options.era;
  const data = await post<Omit<SeedPreview, "chips"> & { reading: { chips: string[] } | null }>(
    url,
    body,
    "The preview did not work.",
    options.signal,
  );
  putCards(data.cards);
  return { ...data, chips: data.reading?.chips ?? null };
}

export interface BatchEntry {
  id: number;
  copies: number;
  pool?: "main" | "extra";
}

/** Adds the rows the player kept from a preview. The cube can be one the player just made for the phrase. */
export async function confirmSeed(cubeId: number, entries: BatchEntry[]): Promise<{ added: number; copies: number }> {
  const data = await post<{ added?: number; copies?: number }>(`/api/cubes/${cubeId}/seed/confirm`, { entries }, "Could not add the cards. Try again.");
  return { added: data.added ?? entries.length, copies: data.copies ?? entries.reduce((n, e) => n + e.copies, 0) };
}

/* ---------- a cube's era ---------- */

/** The years a cube's cards come from: the median year, give or take the spread. "2004–2008", or "2006" for one year. */
export function eraLabel(era: CardEra): string {
  const from = Math.round(era.medianYear - era.spread);
  const to = Math.round(era.medianYear + era.spread);
  return from === to ? String(from) : `${from}–${to}`;
}

/** "Matching this cube's era: 2004–2008". */
export function eraNote(era: CardEra): string {
  return `Matching this cube's era: ${eraLabel(era)}`;
}

export interface CubeEra {
  era: CardEra | undefined;
  /** The health note about cards much newer than the rest of the cube, when there is one. */
  newerNote: string | undefined;
}

/** Read the complete saved cube through its owner-checked, era-only endpoint. */
export async function fetchCubeEra(cubeId: number, signal?: AbortSignal): Promise<CubeEra> {
  const response = await fetch(`/api/cubes/${cubeId}/era`, { signal, cache: "no-store" });
  if (!response.ok) throw new EffectApiError("The cube era is not available.", response.status);
  const data = await response.json() as { era?: CardEra; newerCount?: number };
  const era = data.era;
  const valid = era && Number.isFinite(era.medianYear) && Number.isFinite(era.spread) ? era : undefined;
  const count = data.newerCount ?? 0;
  return { era: valid, newerNote: count > 0 ? `${count} ${count === 1 ? "card is" : "cards are"} much newer than the rest of this cube.` : undefined };
}
