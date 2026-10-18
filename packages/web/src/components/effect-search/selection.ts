/**
 * The batch a player builds from search results: click toggles a card, shift-click takes every card between the
 * last click and this one, "select all shown" takes the whole list. The batch keeps its cards across searches.
 * Cards the cube already holds can never enter it.
 */

import type { CardSummary } from "@/lib/card-types";

export interface Batch {
  /** Insertion order is the order cards were picked. */
  cards: ReadonlyMap<number, CardSummary>;
  /** The card of the last click: where a shift-click range starts. */
  anchor: number | null;
}

export const EMPTY_BATCH: Batch = { cards: new Map(), anchor: null };

export type Selectable = (card: CardSummary) => boolean;

export function toggle(batch: Batch, card: CardSummary, selectable: Selectable): Batch {
  const cards = new Map(batch.cards);
  if (cards.has(card.id)) cards.delete(card.id);
  else if (selectable(card)) cards.set(card.id, card);
  else return batch;
  return { cards, anchor: card.id };
}

/** Takes every selectable card from the anchor to `card` in the shown order. With no anchor in view it is a plain click. */
export function selectRange(batch: Batch, shown: readonly CardSummary[], card: CardSummary, selectable: Selectable): Batch {
  const to = shown.findIndex((c) => c.id === card.id);
  const from = batch.anchor == null ? -1 : shown.findIndex((c) => c.id === batch.anchor);
  if (to < 0 || from < 0) return toggle(batch, card, selectable);
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const cards = new Map(batch.cards);
  for (const c of shown.slice(lo, hi + 1)) if (selectable(c)) cards.set(c.id, c);
  return { cards, anchor: card.id };
}

export function selectAllShown(batch: Batch, shown: readonly CardSummary[], selectable: Selectable): Batch {
  const cards = new Map(batch.cards);
  for (const c of shown) if (selectable(c)) cards.set(c.id, c);
  return { cards, anchor: batch.anchor };
}

export function without(batch: Batch, ids: Iterable<number>): Batch {
  const cards = new Map(batch.cards);
  for (const id of ids) cards.delete(id);
  return { cards, anchor: batch.anchor != null && cards.has(batch.anchor) ? batch.anchor : null };
}

/** True when every selectable card on show is in the batch (and there is at least one). */
export function allShownSelected(batch: Batch, shown: readonly CardSummary[], selectable: Selectable): boolean {
  const pickable = shown.filter(selectable);
  return pickable.length > 0 && pickable.every((c) => batch.cards.has(c.id));
}
