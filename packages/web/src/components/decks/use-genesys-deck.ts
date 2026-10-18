"use client";

import { useEffect, useMemo, useState } from "react";
import type { DuelCardInfo, DuelDeck, DuelMode, GenesysCard, GenesysSettings } from "@yugidraft/shared/duels";
import { getDuelCards } from "../duel/api";
import { summarizeGenesys, type GenesysSummary } from "./genesys";

/** The cards a duel lookup answered, as the rules module reads them. An artwork keeps its alias to the main card. */
export function genesysCatalogFrom(cards: readonly DuelCardInfo[]): Map<number, GenesysCard> {
  const catalog = new Map<number, GenesysCard>();
  for (const card of cards) {
    catalog.set(card.code, {
      name: card.name,
      type: card.type,
      genesysPoints: card.genesysPoints,
      ...(card.canonicalPasscode != null && card.canonicalPasscode !== card.code ? { alias: card.canonicalPasscode } : {}),
    });
  }
  return catalog;
}

function deckCodes(deck: DuelDeck, mode: DuelMode): number[] {
  const codes = [...deck.main, ...deck.extra, ...deck.side];
  if (mode === "domain" && deck.deckMaster != null) codes.push(deck.deckMaster);
  return [...new Set(codes)].sort((a, b) => a - b);
}

/**
 * The Genesys figures of a deck in a room, for a read-only summary. It looks the cards up by passcode and,
 * for an artwork, its main card too, because the points sit on the main card. Returns null when the room is not Genesys.
 */
export function useGenesysDeckSummary(deck: DuelDeck, mode: DuelMode, genesys: GenesysSettings | null | undefined): {
  summary: GenesysSummary | null;
  catalog: ReadonlyMap<number, GenesysCard>;
  failed: boolean;
} {
  const on = genesys != null;
  const key = on ? deckCodes(deck, mode).join(",") : "";
  const [state, setState] = useState<{ key: string; catalog: Map<number, GenesysCard>; settled: Set<number>; failed: boolean } | null>(null);

  useEffect(() => {
    if (!on || !key) return;
    let cancelled = false;
    const codes = key.split(",").map(Number);
    void (async () => {
      try {
        const first = await getDuelCards(codes);
        const have = new Set(first.cards.map((card) => card.code));
        const mains = [...new Set(first.cards.flatMap((card) => card.canonicalPasscode != null && card.canonicalPasscode !== card.code && !have.has(card.canonicalPasscode) ? [card.canonicalPasscode] : []))];
        const second = mains.length ? await getDuelCards(mains) : { cards: [] as DuelCardInfo[], missing: [] as number[] };
        if (cancelled) return;
        setState({
          key,
          catalog: genesysCatalogFrom([...first.cards, ...second.cards]),
          settled: new Set([...first.missing, ...second.missing, ...codes]),
          failed: false,
        });
      } catch {
        if (!cancelled) setState({ key, catalog: new Map(), settled: new Set(codes), failed: true });
      }
    })();
    return () => { cancelled = true; };
  }, [on, key]);

  const current = state?.key === key ? state : null;
  const catalog = useMemo(() => current?.catalog ?? new Map<number, GenesysCard>(), [current]);
  const summary = useMemo(
    () => (genesys ? summarizeGenesys(deck, mode, catalog, genesys, current?.settled ?? new Set()) : null),
    [genesys, deck, mode, catalog, current],
  );
  return { summary, catalog, failed: current?.failed ?? false };
}
