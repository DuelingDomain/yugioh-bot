import type { DuelDeck } from "./index.js";

/** A card the deck uses more often than the pool allows. */
export interface DeckPoolIssue {
  code: number;
  used: number;
  available: number;
}

/** Copies of each passcode across main, extra, side and the Deck Master. */
export function deckCardCounts(deck: DuelDeck): Map<number, number> {
  const counts = new Map<number, number>();
  const codes = [...deck.main, ...deck.extra, ...deck.side];
  if (deck.deckMaster !== undefined) codes.push(deck.deckMaster);
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return counts;
}

/**
 * Checks a deck against a card pool (passcode -> copies available). Returns one
 * issue per passcode the deck uses more often than the pool has, sorted by
 * passcode. An empty list means the deck is legal for the pool.
 */
export function checkDeckAgainstPool(deck: DuelDeck, pool: ReadonlyMap<number, number>): DeckPoolIssue[] {
  const issues: DeckPoolIssue[] = [];
  for (const [code, used] of deckCardCounts(deck)) {
    const available = pool.get(code) ?? 0;
    if (used > available) issues.push({ code, used, available });
  }
  return issues.sort((a, b) => a.code - b.code);
}
