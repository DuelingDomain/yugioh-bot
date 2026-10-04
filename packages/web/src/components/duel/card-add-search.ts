"use client";

import { useEffect, useRef, useState } from "react";
import {
  CARD_POOL_OCG,
  CARD_POOL_TCG,
  cardLimit,
  emptyCardQuery,
  NO_BANLIST_ID,
  type DeckCardInfo,
  type DuelSettings,
} from "@yugidraft/shared/duels";
import { getDeckCardFacets, queryDeckCards } from "../decks/api";

/** Results the "Add card" dropdown shows. */
export const ADD_RESULT_LIMIT = 8;
/** Same pause as the cube and draft-pool card search before it asks the server. */
export const ADD_SEARCH_DEBOUNCE_MS = 250;

// Mirrors the ot checks of isPlayable in duel-server/src/deck-legality.ts.
const OT_ILLEGAL = 0x8;
const OT_VIDEO_GAME = 0x10;
const OT_CUSTOM = 0x20;
const OT_RUSH = 0x200;
const OT_HIDDEN = 0x1000;
const OT_UNPLAYABLE = OT_RUSH | OT_ILLEGAL | OT_VIDEO_GAME | OT_CUSTOM | OT_HIDDEN;

export type BanlistLimits = Readonly<Record<number, 0 | 1 | 2>>;

/**
 * Why the room's deck check would refuse this card on its own (the format, not the copy count), or
 * null when it can be added. The deck check still runs on the whole deck after the card is added.
 */
export function cardAddBlock(
  card: DeckCardInfo,
  settings: Pick<DuelSettings, "cardPool" | "validateDeck">,
  limits?: BanlistLimits,
): string | null {
  if ((card.ot & (CARD_POOL_OCG | CARD_POOL_TCG)) === 0 || (card.ot & OT_UNPLAYABLE) !== 0) return "Not playable";
  if (settings.cardPool === "tcg" && (card.ot & CARD_POOL_TCG) === 0) return "Not TCG legal";
  if (settings.cardPool === "ocg" && (card.ot & CARD_POOL_OCG) === 0) return "Not OCG legal";
  if (settings.validateDeck && limits && cardLimit(limits, card) === 0) return "Forbidden";
  return null;
}

export type CardNameSearch = { query: string; cards?: DeckCardInfo[]; error?: string };

/**
 * Name search for the "Add card" field: waits for typing to pause, then asks the deck-builder card
 * search (best name match first). A reply that no longer matches the field is ignored.
 */
export function useCardNameSearch(
  query: string,
  /** Skip the pause: the player pressed Enter or Add and is waiting for the answer. */
  immediate = false,
): { search: CardNameSearch | null; pending: boolean } {
  const trimmed = query.trim();
  const [search, setSearch] = useState<CardNameSearch | null>(null);
  const reqId = useRef(0);
  const latest = useRef(search);
  useEffect(() => { latest.current = search; }, [search]);

  useEffect(() => {
    const myReq = ++reqId.current;
    if (!trimmed) return undefined;
    // Going from "wait for the answer" back to normal must not search again for text already answered.
    if (latest.current?.query === trimmed) return undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      const request = { ...emptyCardQuery(), text: trimmed, scope: "name" as const, sort: "match" as const, limit: ADD_RESULT_LIMIT };
      queryDeckCards(request, controller.signal).then(
        ({ cards }) => {
          if (myReq === reqId.current) setSearch({ query: trimmed, cards: cards.slice(0, ADD_RESULT_LIMIT) });
        },
        (error: unknown) => {
          if (myReq !== reqId.current || controller.signal.aborted) return;
          setSearch({ query: trimmed, error: error instanceof Error ? error.message : "Could not search cards." });
        },
      );
    }, immediate ? 0 : ADD_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmed, immediate]);

  const current = trimmed && search?.query === trimmed ? search : null;
  return { search: current, pending: trimmed !== "" && current === null };
}

/** The room's banlist as copy limits. Loaded on first use; a failed load only means no early "Forbidden" mark. */
export function useBanlistLimits(banlist: string | undefined, wanted: boolean, enabled: boolean): BanlistLimits | undefined {
  const [loaded, setLoaded] = useState<{ banlist: string; limits?: BanlistLimits } | null>(null);
  const need = wanted && enabled && !!banlist && banlist !== NO_BANLIST_ID;
  useEffect(() => {
    if (!need || !banlist || loaded?.banlist === banlist) return undefined;
    let cancelled = false;
    void getDeckCardFacets().then(
      (facets) => { if (!cancelled) setLoaded({ banlist, limits: facets.banlists[banlist] }); },
      () => { if (!cancelled) setLoaded({ banlist }); },
    );
    return () => { cancelled = true; };
  }, [need, banlist, loaded?.banlist]);
  return need && loaded?.banlist === banlist ? loaded.limits : undefined;
}
