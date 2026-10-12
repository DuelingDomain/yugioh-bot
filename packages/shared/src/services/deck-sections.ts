import type Database from "better-sqlite3";
import type { DeckCardType } from "../duels/extra-deck.js";

/** Resolve a saved catalog/engine passcode, including artwork-family members, without a network request. */
export function createDeckTypeLookup(db: Database.Database): (code: number) => DeckCardType | undefined {
  const find = db.prepare<[number, number], { type: string; name: string; frame_type: string }>(
    `select type, name, frame_type from card_catalog where ygoprodeck_id = ?
     union all
     select cc.type, cc.name, cc.frame_type from card_artworks a
       join card_catalog cc on cc.ygoprodeck_id = a.card_id where a.artwork_id = ?
     limit 1`,
  );
  return code => {
    const card = find.get(code, code);
    return card ? { type: card.type, name: card.name, frameType: card.frame_type } : undefined;
  };
}
