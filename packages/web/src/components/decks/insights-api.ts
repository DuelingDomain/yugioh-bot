import type { DeckCardInfo, DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import type { RankedInsightCard } from "@yugidraft/shared/cards/effects";
import type { CardInsightFormat } from "@yugidraft/shared/services";
import { getDeckCards } from "./api";

export type { RankedInsightCard };

/** A ranked card with its card details, ready to show and to add. */
export type InsightCard = DeckCardInfo & { reason: string; linkedCards: number; deckMasterFit?: boolean };

export function insightFormat(mode: DuelMode, genesys: boolean): CardInsightFormat {
  if (genesys) return mode === "domain" ? "genesys-domain" : "genesys";
  return mode === "domain" ? "domain" : "normal";
}

export class InsightsDisabledError extends Error {
  constructor() {
    super("Effect search is off.");
    this.name = "InsightsDisabledError";
  }
}

async function postInsights(body: Record<string, unknown>, signal?: AbortSignal): Promise<{ cards: RankedInsightCard[] }> {
  const res = await fetch("/api/cards/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 404) throw new InsightsDisabledError();
  if (!res.ok) throw new Error(`Suggestions are not available (${res.status}).`);
  const data = (await res.json()) as { cards?: RankedInsightCard[] };
  return { cards: Array.isArray(data.cards) ? data.cards : [] };
}

export interface InsightScope {
  mode: DuelMode;
  genesys: boolean;
  /** Draft deck mode: only these canonical passcodes can be suggested. */
  pool?: readonly number[];
  deckMaster?: number | null;
  genesysRemaining?: number;
  limit?: number;
}

function scopeBody(scope: InsightScope): Record<string, unknown> {
  return {
    format: insightFormat(scope.mode, scope.genesys),
    ...(scope.pool ? { pool: scope.pool.slice(0, 5000) } : {}),
    ...(scope.deckMaster != null && scope.mode === "domain" ? { deckMaster: scope.deckMaster } : {}),
    ...(scope.genesys && scope.genesysRemaining != null ? { genesysRemaining: Math.max(0, Math.min(1000, Math.floor(scope.genesysRemaining))) } : {}),
    ...(scope.limit ? { limit: scope.limit } : {}),
  };
}

const SUGGEST_DECK_MAX = 100;

/** The deck as the route reads it: each section without repeats, at most 100 entries (Side first, then the tail of Main). */
export function insightDeck(deck: DuelDeck): { main: number[]; extra: number[]; side: number[]; deckMaster?: number } {
  const unique = (codes: readonly number[]) => [...new Set(codes)];
  const side = unique(deck.side).slice(0, SUGGEST_DECK_MAX);
  const extra = unique(deck.extra).slice(0, SUGGEST_DECK_MAX - side.length);
  const mainAll = unique(deck.main);
  const room = Math.max(0, SUGGEST_DECK_MAX - side.length - extra.length);
  const main = room >= mainAll.length ? mainAll : mainAll.slice(mainAll.length - room);
  return { main, extra, side, ...(deck.deckMaster != null ? { deckMaster: deck.deckMaster } : {}) };
}

/** A string that changes only when the cards the route reads change. */
export function insightDeckKey(deck: DuelDeck): string {
  const d = insightDeck(deck);
  return `${d.main.join(",")}|${d.extra.join(",")}|${d.side.join(",")}|${d.deckMaster ?? ""}`;
}

/** Cards that link to the most cards of a deck. */
export async function fetchSuggestions(deck: DuelDeck, scope: InsightScope, signal?: AbortSignal): Promise<RankedInsightCard[]> {
  return (await postInsights({ op: "suggest", deck: insightDeck(deck), ...scopeBody(scope) }, signal)).cards;
}

/** Cards that work with one card. */
export async function fetchWorksWith(passcode: number, scope: InsightScope, signal?: AbortSignal): Promise<RankedInsightCard[]> {
  return (await postInsights({ op: "worksWith", passcode, ...scopeBody(scope) }, signal)).cards;
}

/** Card details for ranked cards, in rank order. A card the engine does not know is left out. */
export async function resolveInsightCards(ranked: readonly RankedInsightCard[], mode: DuelMode, signal?: AbortSignal): Promise<InsightCard[]> {
  if (ranked.length === 0) return [];
  const { cards } = await getDeckCards(ranked.map((item) => item.passcode), { mode });
  if (signal?.aborted) return [];
  const byCode = new Map(cards.map((card) => [card.code, card]));
  const out: InsightCard[] = [];
  for (const item of ranked) {
    const card = byCode.get(item.passcode);
    if (card) out.push({ ...card, reason: item.reason, linkedCards: item.linkedCards, ...(item.deckMasterFit != null ? { deckMasterFit: item.deckMasterFit } : {}) });
  }
  return out;
}
