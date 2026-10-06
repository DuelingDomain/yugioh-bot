import { canonicalCardCode, cardTypeRank, CARD_TYPE_BITS } from "@yugidraft/shared/duels";
import type { CardDataGapCard, CardDataGapStatus, CatalogSetStatus } from "@yugidraft/shared/types";

export interface EngineCard { id: number; alias: number; name: string; type: number }
export interface GapCatalogCard {
  id: number; name: string; type: string; frameType: string;
  cardSets: Array<{ set_name: string; set_code?: string }>;
  artworkIds?: number[];
}
export interface CachedCardSet extends CatalogSetStatus { cards: GapCatalogCard[] | null; checkedAt: string | null }
export interface ArtworkFamily { cardId: number; artworkId: number }
const name = (value: string) => value.trim().toLowerCase();
export const playableCatalogCard = (card: GapCatalogCard) => !["skill", "token"].includes(name(card.frameType))
  && !/\b(skill|token)\b/i.test(card.type);

// YGOPRODeck spells/traps use generic type labels. Monster labels carry the
// same frame/subtype distinctions as the CDB; ignore engine-only flags.
function engineTypeKey(type: number): string {
  const T = CARD_TYPE_BITS;
  if (!(type & T.monster)) return String(type & (T.spell | T.trap));
  return `${cardTypeRank(type)}:${type & (T.tuner | T.pendulum | T.spirit | T.union | T.gemini | T.flip | T.toon)}`;
}
function catalogTypeKey(card: GapCatalogCard): string {
  const value = name(`${card.type} ${card.frameType}`), T = CARD_TYPE_BITS;
  let bits = /spell/.test(value) ? T.spell : /trap/.test(value) ? T.trap : T.monster;
  if (bits === T.monster) {
    bits |= /normal/.test(value) ? T.normal : T.effect;
    for (const [label, bit] of Object.entries(T)) if (new RegExp(`\\b${label}\\b`).test(value.replaceAll("_", " "))) bits |= bit;
  }
  return engineTypeKey(bits);
}

/** Union passcodes using canonicalCardCode and independently proven artwork families. */
export function computeCardDataGap(
  engine: readonly EngineCard[], catalog: readonly GapCatalogCard[],
  artworks: readonly ArtworkFamily[], sets: readonly CatalogSetStatus[], recent: readonly CachedCardSet[] = [],
): CardDataGapStatus {
  const parents = new Map<number, number>();
  const root = (id: number): number => {
    let current = id;
    while (parents.has(current)) current = parents.get(current)!;
    while (parents.has(id)) { const next = parents.get(id)!; parents.set(id, current); id = next; }
    return current;
  };
  const union = (a: number, b: number) => {
    const left = root(a), right = root(b);
    if (left !== right) parents.set(Math.max(left, right), Math.min(left, right));
  };
  const playableEngine = engine.filter(c => !(c.type & CARD_TYPE_BITS.token) && !(c.type & 0x8000000));
  const identity = new Map(playableEngine.map(c => [c.id, c]));
  for (const card of playableEngine) union(card.id, canonicalCardCode(card.id, identity));
  for (const art of artworks) union(art.cardId, art.artworkId);
  for (const card of [...catalog, ...recent.flatMap(set => set.cards ?? [])]) {
    if (playableCatalogCard(card)) for (const id of card.artworkIds ?? []) union(card.id, id);
  }
  const engineFamilies = new Set(playableEngine.map(c => root(c.id)));
  const engineNames = new Set(playableEngine.map(c => `${name(c.name)}:${engineTypeKey(c.type)}`));
  const setIndex = new Map(sets.map(s => [s.name, s]));
  const mains = new Set(artworks.map(a => a.cardId));
  const compare = (cards: readonly GapCatalogCard[], set?: CatalogSetStatus) => {
    const families = new Set<number>(), missing = new Map<number, CardDataGapCard>(), mismatch = new Map<number, CardDataGapCard>();
    for (const card of cards) {
      if (!playableCatalogCard(card)) continue;
      const family = root(card.id); families.add(family);
      if (engineFamilies.has(family)) continue;
      let row: CardDataGapCard = { id: card.id, name: card.name, setCode: set?.code ?? null, setReleaseDate: set?.releaseDate ?? null };
      for (const printing of card.cardSets) {
        if (set && printing.set_name !== set.name) continue;
        const info = setIndex.get(printing.set_name), releaseDate = info?.releaseDate ?? null;
        const setCode = printing.set_code ?? (set ? row.setCode : info?.code) ?? null;
        const newer = (releaseDate ?? "") > (row.setReleaseDate ?? "");
        const sameDateWithCode = releaseDate === row.setReleaseDate && row.setCode === null && setCode !== null;
        if (set || newer || sameDateWithCode) row = { ...row, setCode, setReleaseDate: set?.releaseDate ?? releaseDate };
      }
      const target = engineNames.has(`${name(card.name)}:${catalogTypeKey(card)}`) ? mismatch : missing;
      const previous = target.get(family);
      if (!previous) { target.set(family, row); continue; }
      const preferred = !mains.has(previous.id) && (mains.has(card.id) || card.id < previous.id) ? row : previous;
      const printing = (row.setReleaseDate ?? "") > (previous.setReleaseDate ?? "") ? row : previous;
      target.set(family, { ...preferred, setCode: printing.setCode, setReleaseDate: printing.setReleaseDate });
    }
    const sorted = (rows: Map<number, CardDataGapCard>) => [...rows.values()].sort((a, b) =>
      (b.setReleaseDate ?? "").localeCompare(a.setReleaseDate ?? "") || a.id - b.id);
    return { total: families.size, missing, missingCards: sorted(missing), idMismatch: sorted(mismatch) };
  };
  const cached = compare(catalog);
  const recentMissing = new Set<number>();
  const recentSets = recent.map(({ cards, checkedAt, ...set }) => {
    if (cards === null) return { ...set, status: "unknown" as const, checkedAt, total: null, missingCount: null, missingCards: [], idMismatch: [] };
    const result = compare(cards, set);
    for (const family of result.missing.keys()) recentMissing.add(family);
    return { ...set, status: "ok" as const, checkedAt, total: result.total, missingCount: result.missing.size,
      missingCards: result.missingCards, idMismatch: result.idMismatch };
  });
  return {
    recentSetsMissingFromEngineCount: recentMissing.size,
    recentSetsUnknownCount: recent.filter(s => s.cards === null).length,
    recentSets, cachedCatalogMissingCount: cached.missing.size, cachedCatalogMissing: cached.missingCards,
    cachedCatalogIdMismatch: cached.idMismatch,
  };
}
