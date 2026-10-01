import type { DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import { buildDeck, type Catalog } from "../fuzz/card-pool.js";
import type { Rng } from "../fuzz/rng.js";

/**
 * One deck per seat from one seeded RNG. At n = 2 this is exactly `buildDecks` of the old fuzz
 * (same RNG calls in the same order), so the same seed gives the same two decks.
 * Half of the scenarios use code-disjoint decks: each deck avoids every code an earlier deck uses.
 */
export function buildSeatDecks(
  catalog: Catalog,
  rng: Rng,
  mode: DuelMode,
  seats: number,
): { decks: DuelDeck[]; disjoint: boolean; notes: string[] } {
  const first = buildDeck(catalog, rng, mode, new Set());
  const disjoint = rng.chance(0.5);
  const used = new Set<number>();
  const remember = (deck: DuelDeck) => {
    if (!disjoint) return;
    for (const id of [...deck.main, ...deck.extra]) used.add(id);
    if (deck.deckMaster) used.add(deck.deckMaster);
  };
  remember(first.deck);
  const decks = [first.deck];
  const notes = [first.note];
  for (let seat = 1; seat < seats; seat++) {
    // The old fuzz copies `used` into the disallowed set before the second deck; a later deck sees the codes of all earlier decks.
    const built = buildDeck(catalog, rng, mode, used);
    decks.push(built.deck);
    notes.push(built.note);
    remember(built.deck);
  }
  return { decks, disjoint, notes };
}
