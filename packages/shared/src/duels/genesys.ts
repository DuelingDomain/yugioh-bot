import { CARD_TYPE_BITS } from "./card-query.js";
import type { DeckCardType } from "./extra-deck.js";
import type { DuelDeck, DuelDeckCardRef } from "./index.js";
import { canonicalCardCode } from "./pool.js";
import type { GenesysSettings } from "./settings.js";

/** Engine identity plus points from the current TCG list. Missing points are unknown. */
export interface GenesysCard {
  name: string;
  type: number;
  alias?: number;
  genesysPoints?: number | null;
}

export type GenesysCardCatalog = ReadonlyMap<number, GenesysCard>;

/** Provenance of the last successfully committed points snapshot. */
export interface GenesysPointsList {
  revision: string;
  effectiveDate: string;
  sourceUrl: string;
  syncedAt: string;
}

export interface GenesysDeckPoints {
  /** null if any copy has unknown points; never substitute the known subtotal. */
  totalPoints: number | null;
  knownPoints: number;
  unknownCards: DuelDeckCardRef[];
}

export type GenesysProblem =
  | { kind: "over-cap"; message: string; pointCap: number; totalPoints: number }
  | { kind: "forbidden-type"; message: string; cards: DuelDeckCardRef[] }
  | { kind: "unknown-points"; message: string; cards: DuelDeckCardRef[] };

export interface GenesysDeckResult {
  valid: boolean;
  pointCap: number;
  totalPoints: number | null;
  knownPoints: number;
  problems: GenesysProblem[];
}

/** Supports both engine type bits and catalog type strings. */
export function isGenesysForbiddenType(card: DeckCardType | null | undefined): boolean {
  const type = card?.type;
  if (typeof type === "number") return (type & (CARD_TYPE_BITS.link | CARD_TYPE_BITS.pendulum)) !== 0;
  return typeof type === "string" && /\b(link|pendulum)\b/i.test(type);
}

function deckRefs(deck: DuelDeck, catalog: GenesysCardCatalog): DuelDeckCardRef[] {
  const refs: DuelDeckCardRef[] = [];
  for (const section of ["main", "extra", "side", "deckMaster"] as const) {
    const codes = section === "deckMaster" ? (deck.deckMaster === undefined ? [] : [deck.deckMaster]) : deck[section];
    codes.forEach((code, index) => refs.push({ section, index, code, ...(catalog.get(code) ? { name: catalog.get(code)!.name } : {}) }));
  }
  return refs;
}

/** Every copy counts, including a supplied Deck Master. Only proven artwork aliases share points. */
export function genesysDeckPoints(deck: DuelDeck, catalog: GenesysCardCatalog): GenesysDeckPoints {
  let knownPoints = 0;
  const unknownCards: DuelDeckCardRef[] = [];
  for (const ref of deckRefs(deck, catalog)) {
    const points = catalog.get(canonicalCardCode(ref.code, catalog))?.genesysPoints;
    if (typeof points !== "number" || !Number.isSafeInteger(points) || points < 0) unknownCards.push(ref);
    else knownPoints += points;
  }
  return { totalPoints: unknownCards.length ? null : knownPoints, knownPoints, unknownCards };
}

/** Genesys-only checks for one player's deck. Base-mode sizes and copy limits remain separate. */
export function checkGenesysDeck(deck: DuelDeck, catalog: GenesysCardCatalog, settings: GenesysSettings): GenesysDeckResult {
  const { totalPoints, knownPoints, unknownCards } = genesysDeckPoints(deck, catalog);
  const forbiddenCards = deckRefs(deck, catalog).filter(ref => isGenesysForbiddenType(catalog.get(ref.code)));
  const problems: GenesysProblem[] = [];
  if (forbiddenCards.length) problems.push({
    kind: "forbidden-type", message: "Genesys does not allow Link or Pendulum Monsters, including the Deck Master.", cards: forbiddenCards,
  });
  if (unknownCards.length) problems.push({
    kind: "unknown-points", message: "Genesys points are unknown for one or more cards. Refresh the TCG points list before playing.", cards: unknownCards,
  });
  if (knownPoints > settings.pointCap) problems.push({
    kind: "over-cap", message: `Deck uses ${totalPoints === null ? "at least " : ""}${knownPoints} Genesys points; the cap is ${settings.pointCap}.`,
    pointCap: settings.pointCap, totalPoints: knownPoints,
  });
  return { valid: problems.length === 0, pointCap: settings.pointCap, totalPoints, knownPoints, problems };
}
