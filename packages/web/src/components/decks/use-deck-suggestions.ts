"use client";

import { useEffect, useRef, useState } from "react";
import type { DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import { InsightsDisabledError, fetchSuggestions, insightDeckKey, resolveInsightCards, type InsightCard } from "./insights-api";

/** The deck can change by a card every second while a player builds; one request follows the last change. */
const SUGGEST_DEBOUNCE_MS = 700;
export const SUGGESTION_COUNT = 20;
/** Unknown cards are dropped on the way, so ask for a few more than the panel shows. */
const SUGGEST_COUNT_LIMIT = SUGGESTION_COUNT + 6;

export type SuggestionsState = {
  /** off: the server has effect search off. idle: nothing to rank yet. */
  status: "off" | "idle" | "loading" | "ready" | "error";
  cards: InsightCard[];
  error: string | null;
};

const IDLE: SuggestionsState = { status: "idle", cards: [], error: null };

/** A short key for a pool, so a new pool array with the same cards does not ask again. */
function poolKey(pool: readonly number[] | undefined): string {
  if (!pool) return "";
  let hash = 0;
  for (const code of pool) hash = (Math.imul(hash, 31) + code) | 0;
  return `${pool.length}:${hash}`;
}

/**
 * The 20 cards that link to the most cards of the deck. It asks only while `enabled` (the tab is open), waits for the
 * deck to rest, and keeps the old list on screen while the new one loads, so the editor never waits for it.
 * `remaining` is the Genesys points left under the cap; it is ignored outside Genesys.
 */
export function useDeckSuggestions({
  enabled,
  deck,
  mode,
  genesys,
  remaining,
  pool,
  slug,
  retry = 0,
}: {
  enabled: boolean;
  deck: DuelDeck;
  mode: DuelMode;
  genesys: boolean;
  remaining: number | null;
  pool?: readonly number[];
  /** The room, so the room's admission rules mark cards that cannot be added. */
  slug?: string;
  retry?: number;
}): SuggestionsState {
  const [state, setState] = useState<SuggestionsState>(IDLE);
  const latest = useRef({ deck, pool, mode, genesys, remaining, slug });
  latest.current = { deck, pool, mode, genesys, remaining, slug };
  const deckKey = insightDeckKey(deck);
  const filled = deck.main.length + deck.extra.length + deck.side.length > 0;
  const scopeKey = `${mode}|${slug ?? ""}|${genesys}|${genesys ? remaining ?? "" : ""}|${poolKey(pool)}`;

  useEffect(() => {
    if (!enabled) return;
    if (!filled) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ status: "loading", cards: prev.cards, error: null }));
    const timer = window.setTimeout(() => {
      const current = latest.current;
      void (async () => {
        try {
          const ranked = await fetchSuggestions(
            current.deck,
            {
              mode: current.mode,
              genesys: current.genesys,
              ...(current.pool ? { pool: current.pool } : {}),
              deckMaster: current.deck.deckMaster,
              ...(current.genesys && current.remaining != null ? { genesysRemaining: current.remaining } : {}),
              limit: SUGGEST_COUNT_LIMIT,
            },
            controller.signal,
          );
          const cards = (await resolveInsightCards(ranked, { mode: current.mode, ...(current.slug ? { slug: current.slug } : {}) }, controller.signal)).slice(0, SUGGESTION_COUNT);
          if (!controller.signal.aborted) setState({ status: "ready", cards, error: null });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof InsightsDisabledError) setState({ status: "off", cards: [], error: null });
          else setState((prev) => ({ status: "error", cards: prev.cards, error: error instanceof Error ? error.message : "Suggestions are not available." }));
        }
      })();
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // The key strings stand for the deck and the scope; the values themselves are read through the ref.
  }, [enabled, filled, deckKey, scopeKey, retry]);

  return state;
}
