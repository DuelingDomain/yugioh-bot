"use client";

import { useEffect, useMemo, useState } from "react";
import type { DuelCardInfo, DuelDeck, DuelMode, GenesysCard, GenesysSettings, SavedDeck } from "@yugidraft/shared/duels";
import { genesysTotalText, summarizeGenesys, type GenesysSummary } from "../decks/genesys";
import { genesysCatalogFrom } from "../decks/use-genesys-deck";
import { getDuelCards } from "./api";

/** The tag a saved deck carries in a list: "Genesys, cap 100". Empty for a deck without the tag. */
export function savedDeckTag(saved: Pick<SavedDeck, "genesys">): string {
  return saved.genesys ? `Genesys, cap ${saved.genesys.pointCap}` : "";
}

/**
 * Saved-deck choice in a Genesys room. A deck is picked only when it fits the room's cap now: the total is known,
 * is at or below the cap, and no Link or Pendulum Monster is in it (the Deck Master counts in Genesys Domain).
 * Points that are not known never count as 0, so an unknown total can not be picked.
 */
export type GenesysPickState = "valid" | "over" | "forbidden" | "unknown" | "loading" | "failed";

export interface GenesysPick {
  state: GenesysPickState;
  selectable: boolean;
  /** "86", or "86+" while some copies have no points. */
  totalText: string;
  /** "86 / 100 pts"; "86+ / 100 pts" while some copies have no points. */
  pointsText: string;
  /** The short state name for the chip. */
  label: string;
  /** Why the deck can not be picked, or null when it can. */
  reason: string | null;
  /** The known points as a share of the cap, 0..1, for the bar. */
  fill: number;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const GENESYS_PLAIN_LINE =
  "Genesys: each card has points. Your deck total must be at or below the cap. Link and Pendulum Monsters are not allowed.";

/** The plain line for new players; Genesys Domain adds the Deck Master. */
export function genesysPlainLine(mode: DuelMode): string {
  return mode === "domain" ? `${GENESYS_PLAIN_LINE} In Genesys Domain the Deck Master counts too.` : GENESYS_PLAIN_LINE;
}

/** Judges one summary against the cap. Not allowed cards come first, then the cap, then missing data. */
export function genesysPickFromSummary(summary: GenesysSummary, failed = false): GenesysPick {
  const totalText = genesysTotalText(summary);
  const pointsText = `${totalText} / ${summary.cap} pts`;
  const fill = summary.cap > 0 ? Math.min(1, summary.known / summary.cap) : summary.known > 0 ? 1 : 0;
  const result = (state: GenesysPickState, label: string, reason: string | null): GenesysPick =>
    ({ state, selectable: state === "valid", totalText, pointsText, label, reason, fill });

  const forbidden = summary.forbidden.length;
  if (forbidden > 0) {
    return result("forbidden", "Has Link or Pendulum",
      `${forbidden} ${plural(forbidden, "card is a", "cards are")} Link or Pendulum Monster${forbidden === 1 ? "" : "s"}, which Genesys does not allow.`);
  }
  if (summary.over > 0) {
    return result("over", `Over cap by ${summary.over}`,
      `At least ${summary.over} ${plural(summary.over, "point", "points")} over the cap of ${summary.cap}. Raise the cap or choose another deck.`);
  }
  if (failed) return result("failed", "Unknown points", "The card points could not be loaded, so the deck can not be checked.");
  if (summary.unknownCount > 0) {
    return result("unknown", "Unknown points",
      `Points are unknown for ${summary.unknownCount} ${plural(summary.unknownCount, "card", "cards")}, so the deck can not be checked.`);
  }
  if (summary.pendingCount > 0) return result("loading", "Counting points…", "The card points are loading.");
  return result("valid", "Valid", null);
}

/** The pick state of a saved deck for the room's mode and cap. */
export function savedDeckGenesysPick(
  deck: DuelDeck,
  mode: DuelMode,
  catalog: ReadonlyMap<number, GenesysCard>,
  genesys: GenesysSettings,
  settled: ReadonlySet<number> = new Set(),
  failed = false,
): GenesysPick {
  return genesysPickFromSummary(summarizeGenesys(deck, mode, catalog, genesys, settled), failed);
}

/** The codes whose points a saved-deck list needs: every copy, and the Deck Master of a Domain deck. */
export function savedDeckCodes(decks: readonly Pick<SavedDeck, "deck">[], mode: DuelMode): number[] {
  const codes = new Set<number>();
  for (const { deck } of decks) {
    for (const code of [...deck.main, ...deck.extra, ...deck.side]) codes.add(code);
    if (mode === "domain" && deck.deckMaster != null) codes.add(deck.deckMaster);
  }
  return [...codes].sort((a, b) => a - b);
}

const LOOKUP_BATCH = 500;

async function lookup(codes: readonly number[]): Promise<{ cards: DuelCardInfo[]; missing: number[] }> {
  const cards: DuelCardInfo[] = [];
  const missing: number[] = [];
  for (let start = 0; start < codes.length; start += LOOKUP_BATCH) {
    const answer = await getDuelCards(codes.slice(start, start + LOOKUP_BATCH));
    cards.push(...answer.cards);
    missing.push(...answer.missing);
  }
  return { cards, missing };
}

/**
 * Looks the cards of the saved decks up once. An artwork keeps its link to the main card, because the points sit on the
 * main card, so the main cards are looked up in a second round. Only runs when `enabled` (a Genesys room).
 */
export function useSavedDeckPoints(decks: readonly SavedDeck[] | null, mode: DuelMode, enabled: boolean): {
  catalog: ReadonlyMap<number, GenesysCard>;
  settled: ReadonlySet<number>;
  failed: boolean;
} {
  const key = enabled && decks ? savedDeckCodes(decks.filter((saved) => saved.mode === mode), mode).join(",") : "";
  const [state, setState] = useState<{ key: string; catalog: Map<number, GenesysCard>; settled: Set<number>; failed: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const codes = key.split(",").map(Number);
    void (async () => {
      try {
        const first = await lookup(codes);
        const have = new Set(first.cards.map((card) => card.code));
        const mains = [...new Set(first.cards.flatMap((card) =>
          card.canonicalPasscode != null && card.canonicalPasscode !== card.code && !have.has(card.canonicalPasscode) ? [card.canonicalPasscode] : []))];
        const second = mains.length ? await lookup(mains) : { cards: [] as DuelCardInfo[], missing: [] as number[] };
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
  }, [key]);

  const current = state?.key === key ? state : null;
  return useMemo(() => ({
    catalog: current?.catalog ?? new Map<number, GenesysCard>(),
    settled: current?.settled ?? new Set<number>(),
    failed: current?.failed ?? false,
  }), [current]);
}
