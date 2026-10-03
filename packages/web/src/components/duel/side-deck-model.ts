import type { DuelDeck } from "@yugidraft/shared/duels";
import { TYPE_FUSION, TYPE_LINK, TYPE_SYNCHRO, TYPE_XYZ } from "./constants";

/**
 * Side decking between games of a Best of 3. Pure: the screen keeps a set of marks (cards taken out of
 * the Main or Extra Deck, cards brought in from the Side Deck) and `planSideDeck` turns them into the
 * deck for the next game. Main, Extra and Side must each keep their last-game size
 * (the server checks the same rules again).
 */

export type SwapSection = "main" | "extra";

export interface SwapSource {
  section: SwapSection;
  index: number;
}

/** Cards marked out of the current deck (by section and position) and in from the Side Deck (by position). */
export interface SideMarks {
  out: SwapSource[];
  inn: number[];
}

export const NO_MARKS: SideMarks = { out: [], inn: [] };

export const SIDE_MAIN_MAX = 60;
export const SIDE_MAIN_MIN = 40;
export const SIDE_EXTRA_MAX = 15;

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

export function isMarkedOut(marks: SideMarks, section: SwapSection, index: number): boolean {
  return marks.out.some((mark) => mark.section === section && mark.index === index);
}

export function isMarkedIn(marks: SideMarks, sideIndex: number): boolean {
  return marks.inn.includes(sideIndex);
}

/** Mark a Main or Extra card to go out, or take the mark back. */
export function toggleOut(marks: SideMarks, section: SwapSection, index: number): SideMarks {
  return isMarkedOut(marks, section, index)
    ? { ...marks, out: marks.out.filter((mark) => !(mark.section === section && mark.index === index)) }
    : { ...marks, out: [...marks.out, { section, index }] };
}

/** Mark a Side card to come in, or take the mark back. */
export function toggleIn(marks: SideMarks, sideIndex: number): SideMarks {
  return isMarkedIn(marks, sideIndex)
    ? { ...marks, inn: marks.inn.filter((index) => index !== sideIndex) }
    : { ...marks, inn: [...marks.inn, sideIndex] };
}

export function hasMarks(marks: SideMarks): boolean {
  return marks.out.length > 0 || marks.inn.length > 0;
}

export interface SidePlan {
  /** The deck for the next game with every mark applied. */
  deck: DuelDeck;
  /** Cards marked out and cards marked in. */
  out: number;
  inn: number;
  /** Out equals in and Main and Extra each keep their size. */
  balanced: boolean;
  /** Side destinations cannot be evaluated until every Side card's type is known. */
  typesReady: boolean;
  /** Section sizes after the marks. */
  counts: DeckCounts;
  /** Where each marked-in card goes, by Side position: Extra Deck monsters go to the Extra Deck. */
  destination: ReadonlyMap<number, SwapSection>;
  /** Why Ready is not allowed, or null. */
  reason: string | null;
}

function plural(count: number): string {
  return count === 1 ? "1 card" : `${count} cards`;
}

/**
 * Apply the marks to `deck` (the deck as of the last game). `types` maps a passcode to its card type
 * bits; unknown Side cards stay there and block Ready until their types arrive. `base` is the registered deck: the Main
 * Deck may not drop below 40 cards, or below the base Main size when that is smaller.
 */
export function planSideDeck(
  deck: DuelDeck,
  marks: SideMarks,
  types: ReadonlyMap<number, number>,
  base: DuelDeck = deck,
): SidePlan {
  const outKey = new Set(marks.out.map((mark) => `${mark.section}:${mark.index}`));
  const inSet = new Set(marks.inn);
  const main = deck.main.filter((_, index) => !outKey.has(`main:${index}`));
  const extra = deck.extra.filter((_, index) => !outKey.has(`extra:${index}`));
  const goneMain = deck.main.filter((_, index) => outKey.has(`main:${index}`));
  const goneExtra = deck.extra.filter((_, index) => outKey.has(`extra:${index}`));
  const destination = new Map<number, SwapSection>();
  const typesReady = deck.side.every((code) => types.has(code));
  deck.side.forEach((code, index) => {
    if (!inSet.has(index)) return;
    const type = types.get(code);
    if (type == null) return;
    const section: SwapSection = isExtraDeckType(type) ? "extra" : "main";
    destination.set(index, section);
    (section === "extra" ? extra : main).push(code);
  });
  // The cards that went out join the Side Deck as the cards that came in leave it, so it keeps its length.
  const goneAll = [...goneMain, ...goneExtra];
  const side = deck.side.filter((code, index) => !inSet.has(index) || !types.has(code));
  side.push(...goneAll);
  const next: DuelDeck = { ...deck, main, extra, side };

  const out = marks.out.length;
  const inn = marks.inn.length;
  const balanced = typesReady && out === inn && main.length === deck.main.length && extra.length === deck.extra.length;
  const minMain = Math.min(SIDE_MAIN_MIN, base.main.length);
  let reason: string | null = null;
  if (!typesReady) reason = "Loading card types…";
  else if (out > inn) reason = `Bring in ${plural(out - inn)} from the Side Deck, or put ${plural(out - inn)} back.`;
  else if (inn > out) reason = `Take out ${plural(inn - out)} from the Main or Extra Deck, or put ${plural(inn - out)} back.`;
  else if (main.length !== deck.main.length || extra.length !== deck.extra.length) {
    const sections: string[] = [];
    if (main.length !== deck.main.length) sections.push(`the Main Deck at ${deck.main.length} cards`);
    if (extra.length !== deck.extra.length) sections.push(`the Extra Deck at ${deck.extra.length} cards`);
    reason = `Keep ${sections.join(" and ")} (last game).`;
  }
  else if (main.length < minMain) reason = `The Main Deck needs at least ${minMain} cards. It would have ${main.length}.`;
  else if (main.length > SIDE_MAIN_MAX) reason = `The Main Deck holds at most ${SIDE_MAIN_MAX} cards. It would have ${main.length}.`;
  else if (extra.length > SIDE_EXTRA_MAX) reason = `The Extra Deck holds at most ${SIDE_EXTRA_MAX} cards. It would have ${extra.length}.`;
  return { deck: next, out, inn, balanced, typesReady, counts: deckCounts(next), destination, reason };
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

/** A legal side change: the same cards overall and the same size in every section. */
export function isValidSideChange(before: DuelDeck, after: DuelDeck): boolean {
  return before.main.length === after.main.length && before.extra.length === after.extra.length
    && before.side.length === after.side.length && sameMultiset(before, after);
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

/** Exact equality, including card order. */
export function sameDeck(a: DuelDeck, b: DuelDeck): boolean {
  return sameList(a.main, b.main) && sameList(a.extra, b.extra) && sameList(a.side, b.side)
    && (a.deckMaster ?? null) === (b.deckMaster ?? null);
}

/** Every distinct passcode in the deck, for one card lookup. */
export function deckCodes(deck: DuelDeck): number[] {
  return [...new Set([...deck.main, ...deck.extra, ...deck.side])];
}
