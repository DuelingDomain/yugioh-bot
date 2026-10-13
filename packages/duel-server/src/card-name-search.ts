import type { DuelCardInfo } from "@yugidraft/shared/duels";
import type { OcgCardData } from "ocgcore-wasm";

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/['’‘ʼ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Cache normalized names and tokens once; legality and deck membership stay scoped to each search. */
export function createCardNameSearch(cards: Iterable<DuelCardInfo>, cardData: (code: number) => OcgCardData | null) {
  const entries = Array.from(cards, card => {
    const name = normalizeName(card.name);
    return { card, name, compactName: name.replaceAll(" ", ""), words: name.split(" "), rawName: card.name.toLowerCase() };
  });
  return (query: string, matches?: (card: OcgCardData) => boolean, ownDeck?: ReadonlySet<number>): DuelCardInfo[] => {
    const raw = query.trim().toLowerCase();
    const needle = normalizeName(query);
    if (!needle && !matches && !ownDeck) return [];
    const words = needle.split(" ").filter(Boolean);
    const compactNeedle = needle.replaceAll(" ", "");
    const exactCode = /^\d+$/.test(raw) ? Number(raw) : null;
    const deckOnly = ownDeck !== undefined && needle.length < 2;
    const found: Array<{ card: DuelCardInfo; name: string; rank: number; inDeck: boolean; exactCode: boolean }> = [];
    for (const entry of entries) {
      const inDeck = ownDeck?.has(entry.card.code) ?? false;
      const exact = entry.card.code === exactCode;
      if (deckOnly && !inDeck && !exact) continue;
      let rank = 3;
      if (entry.name === needle) rank = 0;
      else if (entry.name.startsWith(needle)) rank = 1;
      else if (words.every(word => entry.words.some(nameWord => nameWord.startsWith(word)))) rank = 2;
      else if (!exact && !entry.name.includes(needle) && !entry.compactName.includes(compactNeedle)
        && !entry.rawName.includes(raw) && !String(entry.card.code).includes(raw)) continue;
      if (matches) {
        const data = cardData(entry.card.code);
        if (!data || !matches(data)) continue;
      }
      found.push({ card: entry.card, name: entry.name, rank, inDeck, exactCode: exact });
    }
    // Bots and leaving-seat journal replay must keep the original database order for empty searches.
    if (raw || ownDeck !== undefined) found.sort((a, b) => Number(b.exactCode) - Number(a.exactCode)
      || Number(b.rank === 0) - Number(a.rank === 0)
      || Number(b.inDeck) - Number(a.inDeck) || a.rank - b.rank
      || a.name.length - b.name.length || a.name.localeCompare(b.name, "en") || a.card.code - b.card.code);
    return found.slice(0, 50).map(entry => entry.inDeck ? { ...entry.card, inDeck: true } : entry.card);
  };
}
