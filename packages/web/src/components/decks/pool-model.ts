import { deckCardCounts, type DuelDeck } from "@yugidraft/shared/duels";

/** A finished draft and the caller's pool, as the deck editor uses it (from GET /api/drafts/[slug]/deck-pool). */
export interface DraftDeckPool {
  slug: string;
  draftId: number;
  draftName: string;
  /** Engine passcodes with the copies the player drafted. */
  cards: Array<{ code: number; count: number }>;
  /** Pool cards that belong in the Main Deck. */
  mainPoolCount: number;
  /** YGOPRODeck ids the duel engine does not know; they are not in `cards`. */
  unresolved: number[];
  savedDeckId: number | null;
}

export const DRAFT_MAIN_MIN = 40;
export const DRAFT_MAIN_MAX = 60;
export const DRAFT_EXTRA_MAX = 15;

export function poolCounts(cards: ReadonlyArray<{ code: number; count: number }>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const { code, count } of cards) counts.set(code, (counts.get(code) ?? 0) + count);
  return counts;
}

/** Copies of each passcode in the deck (Main, Extra and Side). */
export function deckUsage(deck: DuelDeck): Map<number, number> {
  return deckCardCounts(deck);
}

/** Copies of a card the player can still add: pool copies minus copies in the deck. Never below 0. */
export function remainingCopies(pool: ReadonlyMap<number, number>, used: ReadonlyMap<number, number>, code: number): number {
  return Math.max(0, (pool.get(code) ?? 0) - (used.get(code) ?? 0));
}

/** True when the pool still has a copy to add. A card that is not in the pool never can be added. */
export function canAddFromPool(pool: ReadonlyMap<number, number>, used: ReadonlyMap<number, number>, code: number): boolean {
  return remainingCopies(pool, used, code) > 0;
}

/** The fewest Main Deck cards a draft deck needs: 40, or the whole main pool when it is smaller. */
export function draftMainMinimum(mainPoolCount: number): number {
  return Math.min(DRAFT_MAIN_MIN, Math.max(0, mainPoolCount));
}

/** Short statement of the size rule, for the editor header. */
export function draftRuleText(mainPoolCount: number): string {
  const minimum = draftMainMinimum(mainPoolCount);
  return mainPoolCount < DRAFT_MAIN_MIN
    ? `Main Deck: all ${minimum} main-deck cards from your pool, up to ${DRAFT_MAIN_MAX}. Extra Deck: up to ${DRAFT_EXTRA_MAX}.`
    : `Main Deck: ${minimum} to ${DRAFT_MAIN_MAX} cards. Extra Deck: up to ${DRAFT_EXTRA_MAX}.`;
}

export function draftDeckNotes(deck: DuelDeck, mainPoolCount: number): string[] {
  const notes: string[] = [];
  const minimum = draftMainMinimum(mainPoolCount);
  if (deck.main.length < minimum) notes.push(`Main is ${deck.main.length}; a draft deck needs at least ${minimum}.`);
  if (deck.main.length > DRAFT_MAIN_MAX) notes.push(`Main is ${deck.main.length}; the most is ${DRAFT_MAIN_MAX}.`);
  if (deck.extra.length > DRAFT_EXTRA_MAX) notes.push(`Extra is ${deck.extra.length}; the most is ${DRAFT_EXTRA_MAX}.`);
  if (deck.side.length > DRAFT_EXTRA_MAX) notes.push(`Side is ${deck.side.length}; tables usually cap Side at ${DRAFT_EXTRA_MAX}.`);
  return notes;
}

export function draftMainTone(count: number, mainPoolCount: number): "ok" | "warn" | "bad" {
  if (count > DRAFT_MAIN_MAX) return "bad";
  return count >= draftMainMinimum(mainPoolCount) ? "ok" : "warn";
}
