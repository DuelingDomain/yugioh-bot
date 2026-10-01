import type { DuelDeck } from "@yugidraft/shared/duels";
import { TYPE_FUSION, TYPE_LINK, TYPE_SYNCHRO, TYPE_XYZ } from "./constants";

/**
 * Side-deck swaps between games of a Best of 3. Pure: the panel keeps a draft deck and every swap
 * returns a new deck. A swap exchanges one Main or Extra card with one Side card, so the card
 * multiset and the Side count never change (the server checks the same rules again).
 */

export type SwapSection = "main" | "extra";

export interface SwapSource {
  section: SwapSection;
  index: number;
}

const EXTRA_DECK_TYPES = TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK;

/** Fusion, Synchro, Xyz and Link monsters live in the Extra Deck. */
export function isExtraDeckType(type: number): boolean {
  return (type & EXTRA_DECK_TYPES) !== 0;
}

export interface DeckCounts {
  main: number;
  extra: number;
  side: number;
}

export function deckCounts(deck: DuelDeck): DeckCounts {
  return { main: deck.main.length, extra: deck.extra.length, side: deck.side.length };
}

/** Exchange `deck[from.section][from.index]` with `deck.side[sideIndex]`. Returns a new deck. */
export function swapWithSide(deck: DuelDeck, from: SwapSource, sideIndex: number): DuelDeck {
  const pool = deck[from.section];
  if (!Number.isInteger(from.index) || from.index < 0 || from.index >= pool.length) {
    throw new RangeError(`No ${from.section} deck card at ${from.index}`);
  }
  if (!Number.isInteger(sideIndex) || sideIndex < 0 || sideIndex >= deck.side.length) {
    throw new RangeError(`No side deck card at ${sideIndex}`);
  }
  const nextPool = [...pool];
  const nextSide = [...deck.side];
  nextPool[from.index] = deck.side[sideIndex];
  nextSide[sideIndex] = pool[from.index];
  return { ...deck, [from.section]: nextPool, side: nextSide };
}

/**
 * Why a swap is not allowed, or null when it is. `types` maps a passcode to the card type bits; a
 * card that is not in the map is allowed (the server has the final say).
 */
export function swapProblem(
  deck: DuelDeck,
  from: SwapSource,
  sideIndex: number,
  types: ReadonlyMap<number, number>,
): string | null {
  const out = deck[from.section][from.index];
  const into = deck.side[sideIndex];
  if (out == null || into == null) return "Pick one card from the Main or Extra Deck and one from the Side Deck.";
  const intoType = types.get(into);
  if (intoType != null) {
    const extraCard = isExtraDeckType(intoType);
    if (from.section === "extra" && !extraCard) return "Only an Extra Deck monster can replace an Extra Deck card.";
    if (from.section === "main" && extraCard) return "An Extra Deck monster cannot go into the Main Deck.";
  }
  return null;
}

function tally(codes: Iterable<number>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return counts;
}

/** Every card the deck holds (Main, Extra, Side and the Deck Master), as a count per passcode. */
export function cardMultiset(deck: DuelDeck): Map<number, number> {
  return tally([...deck.main, ...deck.extra, ...deck.side, ...(deck.deckMaster != null ? [deck.deckMaster] : [])]);
}

export function sameMultiset(a: DuelDeck, b: DuelDeck): boolean {
  const left = cardMultiset(a);
  const right = cardMultiset(b);
  if (left.size !== right.size) return false;
  for (const [code, count] of left) if (right.get(code) !== count) return false;
  return true;
}

/** A legal side change: the same cards overall and the same Side Deck size. */
export function isValidSideChange(before: DuelDeck, after: DuelDeck): boolean {
  return before.side.length === after.side.length
    && before.main.length === after.main.length
    && before.extra.length === after.extra.length
    && sameMultiset(before, after);
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

/** Exact equality, including card order. */
export function sameDeck(a: DuelDeck, b: DuelDeck): boolean {
  return sameList(a.main, b.main) && sameList(a.extra, b.extra) && sameList(a.side, b.side)
    && (a.deckMaster ?? null) === (b.deckMaster ?? null);
}

/** Equality ignoring order inside each section: a swap and its undo compare equal. */
export function sameSections(a: DuelDeck, b: DuelDeck): boolean {
  const sorted = (codes: readonly number[]) => [...codes].sort((x, y) => x - y);
  return sameList(sorted(a.main), sorted(b.main)) && sameList(sorted(a.extra), sorted(b.extra))
    && sameList(sorted(a.side), sorted(b.side)) && (a.deckMaster ?? null) === (b.deckMaster ?? null);
}

/** How many cards were swapped away from the base deck (the registered deck). */
export function swapCount(base: DuelDeck, deck: DuelDeck): number {
  const baseSide = tally(base.side);
  let moved = 0;
  for (const [code, count] of tally(deck.side)) moved += Math.max(0, count - (baseSide.get(code) ?? 0));
  return moved;
}

/** Every distinct passcode in the deck, for one card lookup. */
export function deckCodes(deck: DuelDeck): number[] {
  return [...new Set([...deck.main, ...deck.extra, ...deck.side])];
}
