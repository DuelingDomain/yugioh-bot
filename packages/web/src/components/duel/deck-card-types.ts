"use client";

import { useEffect, useState } from "react";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { getDuelCards } from "./api";
import { TYPE_MONSTER } from "./constants";
import { deckCodes } from "./side-deck-model";

/** Only monsters can be the Deck Master, Extra Deck monsters included. An unknown type is not offered. */
export function canBeDeckMaster(type: number | undefined): boolean {
  return type !== undefined && (type & TYPE_MONSTER) !== 0;
}

export interface DeckCardMeta { name: string; type: number }

/** Name and type bitmask for every card in a deck. A card is missing from the map until its lookup ends. */
export function useDeckCardMeta(deck: DuelDeck): ReadonlyMap<number, DeckCardMeta> {
  const [meta, setMeta] = useState<ReadonlyMap<number, DeckCardMeta>>(() => new Map());
  const codesKey = [...deckCodes(deck)].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const codes = codesKey ? codesKey.split(",").map(Number) : [];
    if (codes.length === 0) return undefined;
    let cancelled = false;
    void getDuelCards(codes).then(
      ({ cards }) => {
        if (!cancelled) setMeta((known) => new Map([...known, ...cards.map((card) => [card.code, { name: card.name, type: card.type }] as const)]));
      },
      () => undefined,
    );
    return () => { cancelled = true; };
  }, [codesKey]);
  return meta;
}
