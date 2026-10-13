import type Database from "better-sqlite3";
import { deckEngineDataDirectory, loadArtworkIdentityCatalog } from "./card-artworks.js";
import { loadCardPasscodeRemaps } from "../db/card-passcode-remaps.js";
import type { CardIdentityCatalog } from "../duels/pool.js";
import type { DeckCardType } from "../duels/extra-deck.js";

export type DeckTypeEngineSource = CardIdentityCatalog | (() => CardIdentityCatalog);
type CardTypeLookup = (code: number) => DeckCardType | undefined;

export { hasKnownDeckCardType } from "../duels/extra-deck.js";

/** Resolve a saved catalog/engine passcode, including artwork-family members, without a network request. */
export function createDeckTypeLookup(db: Database.Database, engine?: DeckTypeEngineSource): CardTypeLookup & { snapshot(): CardTypeLookup } {
  const find = db.prepare<[number, number], { type: string; name: string; frame_type: string; card_id: number }>(
    `select cc.type, cc.name, cc.frame_type, coalesce(a.card_id, cc.ygoprodeck_id) as card_id
     from card_catalog cc left join card_artworks a on a.artwork_id = cc.ygoprodeck_id
     where cc.ygoprodeck_id = ?
     union all
     select cc.type, cc.name, cc.frame_type, cc.ygoprodeck_id as card_id from card_artworks a
       join card_catalog cc on cc.ygoprodeck_id = a.card_id where a.artwork_id = ?
     limit 1`,
  );
  const catalogCard = (code: number) => find.get(code, code);
  const directory = () => deckEngineDataDirectory(db.name);
  const loadEngine = typeof engine === "function" ? engine : () => engine ?? loadArtworkIdentityCatalog(directory());
  const loadRemaps = () => engine === undefined ? loadCardPasscodeRemaps(directory()) : new Map<number, number>();
  const lookup = (cards: CardIdentityCatalog, remaps: ReadonlyMap<number, number>, code: number) => {
    // Engine bits are authoritative for an engine passcode, even when its catalog row is absent or stale.
    const resolved = remaps.get(code) ?? code;
    const engineCard = cards.get(resolved);
    if (engineCard?.name.trim()) return engineCard;
    const card = catalogCard(code);
    const base = card && cards.get(remaps.get(card.card_id) ?? card.card_id);
    const authoritative = engineCard ?? base;
    if (authoritative) {
      const alias = authoritative.alias ? cards.get(authoritative.alias) : undefined;
      const name = authoritative.name.trim() || card?.name.trim() || catalogCard(resolved)?.name.trim()
        || (card && catalogCard(card.card_id)?.name.trim())
        || (alias?.type === authoritative.type && (alias.name.trim() || catalogCard(authoritative.alias!)?.name.trim()))
        || `card ${code}`;
      return { ...authoritative, name };
    }
    return card ? { type: card.type, name: card.name, frameType: card.frame_type } : undefined;
  };
  return Object.assign((code: number) => lookup(loadEngine(), loadRemaps(), code), {
    // A deck/list check uses one current map; the next check sees a replaced engine database.
    snapshot(): CardTypeLookup {
      const cards = loadEngine();
      const remaps = loadRemaps();
      return code => lookup(cards, remaps, code);
    },
  });
}
