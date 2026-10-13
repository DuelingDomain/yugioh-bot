import type Database from "better-sqlite3";
import { loadArtworkIdentityCatalog } from "./card-artworks.js";
import type { CardIdentityCatalog } from "../duels/pool.js";
import type { DeckCardType } from "../duels/extra-deck.js";

export type DeckTypeEngineSource = CardIdentityCatalog | (() => CardIdentityCatalog);
type CardTypeLookup = (code: number) => DeckCardType | undefined;

/** An absent or unrecognized type is not evidence that a stored card belongs in Main. */
export function hasKnownDeckCardType(card: DeckCardType | undefined): boolean {
  const type = card?.type;
  return typeof type === "number" ? Number.isInteger(type) && type > 0
    : typeof type === "string" && /\b(monster|spell|trap|token|skill)\b/i.test(type);
}

/** Resolve a saved catalog/engine passcode, including artwork-family members, without a network request. */
export function createDeckTypeLookup(db: Database.Database, engine?: DeckTypeEngineSource): CardTypeLookup & { snapshot(): CardTypeLookup } {
  const find = db.prepare<[number, number], { type: string; name: string; frame_type: string }>(
    `select type, name, frame_type from card_catalog where ygoprodeck_id = ?
     union all
     select cc.type, cc.name, cc.frame_type from card_artworks a
       join card_catalog cc on cc.ygoprodeck_id = a.card_id where a.artwork_id = ?
     limit 1`,
  );
  const loadEngine = typeof engine === "function" ? engine : () => engine ?? loadArtworkIdentityCatalog();
  const lookup = (cards: CardIdentityCatalog, code: number) => {
    // Engine bits are authoritative for an engine passcode, even when its catalog row is absent or stale.
    const engineCard = cards.get(code);
    if (engineCard) return engineCard;
    const card = find.get(code, code);
    return card ? { type: card.type, name: card.name, frameType: card.frame_type } : undefined;
  };
  return Object.assign((code: number) => lookup(loadEngine(), code), {
    // A deck/list check uses one current map; the next check sees a replaced engine database.
    snapshot(): CardTypeLookup {
      const cards = loadEngine();
      return code => lookup(cards, code);
    },
  });
}
