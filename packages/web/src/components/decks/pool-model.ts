import { canonicalCardCode, deckCardCounts, type CardIdentityCatalog, type DuelDeck } from "@yugidraft/shared/duels";
import type { DeckRegistrationMark } from "@yugidraft/shared/services";

/** A finished draft and the caller's pool, as the deck editor uses it (from GET /api/drafts/[slug]/deck-pool). */
export interface DraftDeckPool {
  slug: string;
  draftId: number;
  draftName: string;
  /** Engine passcodes with the copies the player drafted. */
  cards: Array<{ code: number; count: number }>;
  /** Forced picks per engine passcode (a capped pack with no legal swap). Each adds one copy to the 3-copy limit. */
  forcedCopies?: Record<string, number>;
  /** Pool cards that belong in the main deck. */
  mainPoolCount: number;
  /** YGOPRODeck ids the duel engine does not know; they are not in `cards`. */
  unresolved: number[];
  savedDeckId: number | null;
  /** The tournament this draft's deck is registered for, if any. */
  registration: DeckRegistrationMark | null;
}

export const DRAFT_MAIN_MIN = 40;
export const DRAFT_MAIN_MAX = 60;
export const DRAFT_EXTRA_MAX = 15;

export function poolCounts(cards: ReadonlyArray<{ code: number; count: number }>, catalog: CardIdentityCatalog = new Map()): Map<number, number> {
  const counts = new Map<number, number>();
  for (const { code: raw, count } of cards) {
    const code = canonicalCardCode(raw, catalog);
    counts.set(code, (counts.get(code) ?? 0) + count);
  }
  return counts;
}

/** Forced pick counts per canonical passcode; alternate artworks share one count. */
export function forcedCounts(
  forced: Readonly<Record<string, number>> | undefined,
  catalog: CardIdentityCatalog = new Map(),
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [raw, count] of Object.entries(forced ?? {})) {
    const code = canonicalCardCode(Number(raw), catalog);
    if (Number.isInteger(count) && count > 0) counts.set(code, (counts.get(code) ?? 0) + count);
  }
  return counts;
}

/** Copies of each passcode in the deck (Main, Extra and Side). */
export function deckUsage(deck: DuelDeck, catalog: CardIdentityCatalog = new Map()): Map<number, number> {
  return deckCardCounts(deck, (code) => canonicalCardCode(code, catalog));
}

/** Most copies of a card the draft deck can hold: 3, plus one per forced pick, never more than the pool has. */
export function deckAllowance(pool: ReadonlyMap<number, number>, code: number, forced: ReadonlyMap<number, number> = new Map()): number {
  return Math.min(3 + (forced.get(code) ?? 0), pool.get(code) ?? 0);
}

/** Copies of a card the player can still add: the allowance minus copies in the deck. Never below 0. */
export function remainingCopies(
  pool: ReadonlyMap<number, number>,
  used: ReadonlyMap<number, number>,
  code: number,
  forced: ReadonlyMap<number, number> = new Map(),
): number {
  return Math.max(0, deckAllowance(pool, code, forced) - (used.get(code) ?? 0));
}

/** True when the pool still has a copy to add. A card that is not in the pool never can be added. */
export function canAddFromPool(
  pool: ReadonlyMap<number, number>,
  used: ReadonlyMap<number, number>,
  code: number,
  forced: ReadonlyMap<number, number> = new Map(),
): boolean {
  return remainingCopies(pool, used, code, forced) > 0;
}

/** The fewest Main Deck cards a draft deck needs: 40, or the whole main pool when it is smaller. */
export function draftMainMinimum(mainPoolCount: number): number {
  return Math.min(DRAFT_MAIN_MIN, Math.max(0, mainPoolCount));
}

/** Short statement of the size rule, for the editor header. */
export function draftRuleText(mainPoolCount: number): string {
  const minimum = draftMainMinimum(mainPoolCount);
  return mainPoolCount < DRAFT_MAIN_MIN
    ? `Main deck: all ${minimum} main deck cards from your pool, up to ${DRAFT_MAIN_MAX}. Extra deck: up to ${DRAFT_EXTRA_MAX}.`
    : `Main deck: ${minimum} to ${DRAFT_MAIN_MAX} cards. Extra deck: up to ${DRAFT_EXTRA_MAX}.`;
}

/** The same rule in a form that fits on one line in the editor's bar; the full sentence goes in its tooltip. */
export function draftRuleShort(mainPoolCount: number): string {
  const minimum = draftMainMinimum(mainPoolCount);
  return mainPoolCount < DRAFT_MAIN_MIN
    ? `Main: all ${minimum} cards. Extra: up to ${DRAFT_EXTRA_MAX}.`
    : `Main: ${minimum} to ${DRAFT_MAIN_MAX}. Extra: up to ${DRAFT_EXTRA_MAX}.`;
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
