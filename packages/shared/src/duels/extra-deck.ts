import type { DuelDeck } from "./index.js";

export type DeckCardType = { type?: string | number | null; frameType?: string | null; name?: string | null };
const EXTRA_TYPES = 0x40 | 0x2000 | 0x800000 | 0x4000000;
const EXCLUDED_TYPES = 0x2 | 0x4 | 0x4000 | 0x8000000;

/** Building a deck: only Fusion, Synchro, Xyz and Link monsters, including their Pendulum variants.
 * Main-deck Pendulums, Rituals, Tokens, Skills and unknown types cannot enter Extra.
 * A frame never overrides the card's real type. This is not a rule for live duel zones.
 */
export function isExtraDeckCard(card: DeckCardType | null | undefined): boolean {
  const type = card?.type;
  if (typeof type === "number") {
    return Number.isInteger(type) && (type & 0x1) !== 0 && (type & EXCLUDED_TYPES) === 0 && (type & EXTRA_TYPES) !== 0;
  }
  if (typeof type !== "string") return false;
  return /\bmonster\b/i.test(type) && !/\b(spell|trap|token|skill)\b/i.test(type)
    && /\b(fusion|synchro|xyz|link)\b/i.test(type);
}

/** Missing type data must not be treated as a Main Deck type. */
export function hasKnownDeckCardType(card: DeckCardType | undefined): boolean {
  const type = card?.type;
  return typeof type === "number" ? Number.isInteger(type) && (type & (0x1 | 0x2 | 0x4 | 0x8000000)) !== 0
    : typeof type === "string" && /\b(monster|spell|trap|token|skill)\b/i.test(type);
}

export const INVALID_EXTRA_DECK_CARD = "INVALID_EXTRA_DECK_CARD";
export class ExtraDeckCardError extends Error {
  readonly status = 400;
  readonly code = INVALID_EXTRA_DECK_CARD;
  constructor(name: string) {
    super(`Extra Deck can contain only Fusion, Synchro, Xyz, and Link monsters. Move ${name} to Main Deck or Side Deck.`);
    this.name = "ExtraDeckCardError";
  }
}

export function assertExtraDeckCards(deck: Pick<DuelDeck, "extra">, find: (code: number) => DeckCardType | undefined): void {
  for (const code of deck.extra) {
    const card = find(code);
    if (!isExtraDeckCard(card)) throw new ExtraDeckCardError(card?.name?.trim() || `card ${code}`);
  }
}

export interface DeckSectionMove {
  code: number;
  name: string;
  from: "main" | "extra";
  to: "main" | "extra";
}

/** Keep all copies, Side and Master. Section size limits are checked separately; no overflow is discarded. */
export function routeDeckSections(deck: DuelDeck, find: (code: number) => DeckCardType | undefined): {
  deck: DuelDeck; moves: DeckSectionMove[]; messages: string[];
} {
  const moves: DeckSectionMove[] = [];
  const unknownMessages = new Set<string>();
  const main: number[] = [];
  const extra: number[] = [];
  for (const from of ["main", "extra"] as const) {
    for (const code of deck[from]) {
      const card = find(code);
      const known = hasKnownDeckCardType(card);
      const to = known ? (isExtraDeckCard(card) ? "extra" : "main") : from;
      if (!known) unknownMessages.add(`Card type is unknown for ${card?.name?.trim() || `card ${code}`}. The card stays in its ${from === "extra" ? "Extra" : "Main"} Deck section.`);
      (to === "extra" ? extra : main).push(code);
      if (from !== to) moves.push({ code, name: card?.name?.trim() || `card ${code}`, from, to });
    }
  }
  for (const code of deck.side) {
    const card = find(code);
    if (!hasKnownDeckCardType(card)) unknownMessages.add(`Card type is unknown for ${card?.name?.trim() || `card ${code}`}. The card stays in its Side Deck section.`);
  }
  const messages = (["extra", "main"] as const).flatMap(from => {
    const moved = moves.filter(move => move.from === from);
    if (!moved.length) return [];
    const source = from === "extra" ? "Extra" : "Main";
    const target = from === "extra" ? "Main" : "Extra";
    return [`${moved.length} ${moved.length === 1 ? "card" : "cards"} moved from ${source} Deck to ${target} Deck: ${moved.map(move => move.name).join(", ")}.`];
  });
  return { deck: { ...deck, main, extra, side: [...deck.side] }, moves, messages: [...messages, ...unknownMessages] };
}
