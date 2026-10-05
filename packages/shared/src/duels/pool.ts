import type { DuelDeck } from "./index.js";

export type CardIdentityCatalog = ReadonlyMap<number, { name: string; type: number; alias?: number }>;

/** Artworks share a name and type. Other aliases remain different drafted cards. */
export function canonicalCardCode(code: number, catalog: CardIdentityCatalog): number {
  const seen = new Set<number>();
  let current = code;
  while (!seen.has(current)) {
    seen.add(current);
    const card = catalog.get(current);
    const original = card?.alias ? catalog.get(card.alias) : undefined;
    if (!card || !original || card.type !== original.type || card.name.trim().toLowerCase() !== original.name.trim().toLowerCase()) return current;
    current = card.alias!;
  }
  // Bad alias data must not merge unrelated ids or depend on the starting point.
  return code;
}

/** Changes only ids, preserving order, copies, sections, unknown ids and the Deck Master. */
export function mapDeckCodes(deck: DuelDeck, resolve: (code: number) => number): DuelDeck {
  const mapped: DuelDeck = {
    main: deck.main.map(resolve),
    extra: deck.extra.map(resolve),
    side: deck.side.map(resolve),
  };
  if (deck.deckMaster !== undefined) mapped.deckMaster = resolve(deck.deckMaster);
  return mapped;
}

/** A card the deck uses more often than the pool allows. */
export interface DeckPoolIssue {
  code: number;
  used: number;
  available: number;
}

/** Copies of each passcode across main, extra, side and the Deck Master. */
export function deckCardCounts(deck: DuelDeck, resolve: (code: number) => number = (code) => code): Map<number, number> {
  const counts = new Map<number, number>();
  const codes = [...deck.main, ...deck.extra, ...deck.side];
  if (deck.deckMaster !== undefined) codes.push(deck.deckMaster);
  for (const raw of codes) {
    const code = resolve(raw);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

/**
 * Checks a deck against a card pool (passcode -> copies available). Returns one
 * issue per passcode the deck uses more often than the pool has, sorted by
 * passcode. An empty list means the deck is legal for the pool.
 * Each durable forced pick adds one copy to the usual three-copy draft limit.
 */
export function checkDeckAgainstPool(
  deck: DuelDeck,
  pool: ReadonlyMap<number, number>,
  resolve: (code: number) => number = (code) => code,
  forcedCopies: ReadonlyMap<number, number> = new Map(),
): DeckPoolIssue[] {
  const availableCounts = new Map<number, number>();
  for (const [raw, count] of pool) {
    const code = resolve(raw);
    availableCounts.set(code, (availableCounts.get(code) ?? 0) + count);
  }
  const issues: DeckPoolIssue[] = [];
  const forcedCounts = new Map<number, number>();
  for (const [raw, count] of forcedCopies) {
    const code = resolve(raw);
    forcedCounts.set(code, (forcedCounts.get(code) ?? 0) + count);
  }
  for (const [code, used] of deckCardCounts(deck, resolve)) {
    const available = Math.min(3 + (forcedCounts.get(code) ?? 0), availableCounts.get(code) ?? 0);
    if (used > available) issues.push({ code, used, available });
  }
  return issues.sort((a, b) => a.code - b.code);
}
