import { canonicalCardCode, type CardArtworkFamily } from "@yugidraft/shared/duels";
import type { CardDatabase } from "./cards.js";

const indexes = new WeakMap<CardDatabase, Map<number, CardArtworkFamily>>();

/** Only the running engine may decide which passcodes are selectable. No API name matching. */
export function cardArtworkFamily(cards: CardDatabase, code: number): CardArtworkFamily | undefined {
  let index = indexes.get(cards);
  if (!index) {
    index = new Map();
    const catalog = new Map([...cards.all()].map(card => [card.code, card]));
    const families = new Map<number, number[]>();
    for (const id of catalog.keys()) {
      const main = canonicalCardCode(id, catalog);
      const family = families.get(main) ?? [];
      family.push(id);
      families.set(main, family);
    }
    for (const [passcode, ids] of families) {
      ids.sort((a, b) => Number(b === passcode) - Number(a === passcode) || a - b);
      const family = { passcode, artworks: ids.map(id => ({ passcode: id, isMain: id === passcode })) };
      for (const id of ids) index.set(id, family);
    }
    indexes.set(cards, index);
  }
  return index.get(code);
}
