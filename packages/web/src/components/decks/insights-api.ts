import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import type { ArchetypeGuide, CardEra, RankedInsightCard } from "@yugidraft/shared/cards/effects";
import type { CardInsightFormat } from "@yugidraft/shared/services";
import type { CardAdmissionContext } from "@/lib/card-admission-context";
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
  if (!res.ok) throw new Error(`Effect search is not available (${res.status}).`);
  const data = (await res.json()) as { cards?: RankedInsightCard[] };
  return { cards: Array.isArray(data.cards) ? data.cards : [] };
}

export interface InsightScope {
  mode: DuelMode;
  genesys: boolean;
  /** Draft deck mode: only these canonical passcodes can be returned. */
  pool?: readonly number[];
  deckMaster?: number | null;
  genesysRemaining?: number;
  limit?: number;
  era?: CardEra;
}

function scopeBody(scope: InsightScope): Record<string, unknown> {
  return {
    format: insightFormat(scope.mode, scope.genesys),
    ...(scope.pool ? { pool: scope.pool.slice(0, 5000) } : {}),
    ...(scope.deckMaster != null && scope.mode === "domain" ? { deckMaster: scope.deckMaster } : {}),
    ...(scope.genesys && scope.genesysRemaining != null ? { genesysRemaining: Math.max(0, Math.min(1000, Math.floor(scope.genesysRemaining))) } : {}),
    ...(scope.limit ? { limit: scope.limit } : {}),
    ...(scope.era !== undefined ? { era: scope.era } : {}),
  };
}

/** Cards that work with one card. */
export async function fetchWorksWith(passcode: number, scope: InsightScope, signal?: AbortSignal): Promise<RankedInsightCard[]> {
  return (await postInsights({ op: "worksWith", passcode, ...scopeBody(scope) }, signal)).cards;
}

/** Cards outside an archetype that fit one hook of its "How it plays" panel. */
export async function fetchHookCards(archetype: string, hook: number, scope: InsightScope, signal?: AbortSignal): Promise<RankedInsightCard[]> {
  return (await postInsights({ op: "hookSearch", archetype, hook, ...scopeBody(scope) }, signal)).cards;
}

const guides = new Map<string, Promise<ArchetypeGuide | null>>();

/** "How it plays" for the first of these archetypes that has one. Kept after the first answer; a failed call is not kept. */
export function fetchGuide(archetypes: readonly string[], signal?: AbortSignal): Promise<ArchetypeGuide | null> {
  const key = archetypes.join("|").toLowerCase();
  const known = guides.get(key);
  if (known) return known;
  const pending = (async () => {
    const res = await fetch("/api/cards/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "guide", archetypes }), signal });
    if (res.status === 404) throw new InsightsDisabledError();
    if (!res.ok) throw new Error(`Effect search is not available (${res.status}).`);
    const data = (await res.json()) as { guide?: ArchetypeGuide | null };
    return data.guide ?? null;
  })();
  guides.set(key, pending);
  pending.catch(() => guides.delete(key));
  return pending;
}

/** Card details for ranked cards, in rank order. A card the engine does not know is left out. */
export async function resolveInsightCards(ranked: readonly RankedInsightCard[], context: CardAdmissionContext, signal?: AbortSignal): Promise<InsightCard[]> {
  if (ranked.length === 0) return [];
  const { cards } = await getDeckCards(ranked.map((item) => item.passcode), context, signal);
  if (signal?.aborted) return [];
  const byCode = new Map(cards.map((card) => [card.code, card]));
  const out: InsightCard[] = [];
  for (const item of ranked) {
    const card = byCode.get(item.passcode);
    if (card) out.push({ ...card, reason: item.reason, linkedCards: item.linkedCards, ...(item.deckMasterFit != null ? { deckMasterFit: item.deckMasterFit } : {}) });
  }
  return out;
}
