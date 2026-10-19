/** The most cards each deck section holds. Every add path and every save refuses to go past these. */
export const DECK_SECTION_LIMITS = { main: 60, extra: 15, side: 15 } as const;

export type DeckLimitSection = keyof typeof DECK_SECTION_LIMITS;

export const DECK_SECTION_NAMES: Record<DeckLimitSection, string> = { main: "Main Deck", extra: "Extra Deck", side: "Side Deck" };

/** "Main Deck is full (60/60)": what a refused add says. */
export function deckSectionFullMessage(section: DeckLimitSection): string {
  const max = DECK_SECTION_LIMITS[section];
  return `${DECK_SECTION_NAMES[section]} is full (${max}/${max}).`;
}

type Sections = Record<DeckLimitSection, number[]>;

/**
 * Cuts each section to its limit. The first cards stay; the cards after the limit are left out
 * and returned, so the caller can say what was dropped. The Deck Master is not a section and is kept.
 */
export function capDeckSections<T extends Sections>(deck: T): { deck: T; leftOut: Sections } {
  const leftOut: Sections = { main: [], extra: [], side: [] };
  let changed = false;
  const next = { ...deck };
  for (const section of ["main", "extra", "side"] as const) {
    const max = DECK_SECTION_LIMITS[section];
    if (deck[section].length <= max) continue;
    changed = true;
    next[section] = deck[section].slice(0, max) as T[typeof section];
    leftOut[section] = deck[section].slice(max);
  }
  return { deck: changed ? next : deck, leftOut };
}

/** One sentence per section that lost cards, for import reports. */
export function deckLeftOutMessages(leftOut: Sections, nameOf: (code: number) => string | undefined = () => undefined): string[] {
  const messages: string[] = [];
  for (const section of ["main", "extra", "side"] as const) {
    const cards = leftOut[section];
    if (cards.length === 0) continue;
    const max = DECK_SECTION_LIMITS[section];
    const names = cards.slice(0, 5).map((code) => nameOf(code) ?? `card ${code}`).join(", ");
    const more = cards.length > 5 ? `, and ${cards.length - 5} more` : "";
    messages.push(`${DECK_SECTION_NAMES[section]} is full (${max}/${max}). ${cards.length} ${cards.length === 1 ? "card was" : "cards were"} left out: ${names}${more}.`);
  }
  return messages;
}

/** The first section where `next` is over its limit and bigger than `prev`, or null. A smaller or equal count is never refused. */
export function deckGrowthOverLimit(prev: Pick<Sections, DeckLimitSection>, next: Pick<Sections, DeckLimitSection>): DeckLimitSection | null {
  for (const section of ["main", "extra", "side"] as const) {
    if (next[section].length > DECK_SECTION_LIMITS[section] && next[section].length > prev[section].length) return section;
  }
  return null;
}
