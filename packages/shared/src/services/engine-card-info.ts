import Database from "better-sqlite3";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { CARD_RACES, CARD_TYPE_BITS } from "../duels/card-query.js";
import type { DeckCardInfo, DuelCardInfo } from "../duels/index.js";
import { canonicalCardCode } from "../duels/pool.js";
import type { CardCatalogService } from "./card-catalog.js";

type EngineRow = {
  id: bigint; ot: bigint; alias: bigint; setcode: bigint; type: bigint;
  atk: bigint; def: bigint; level: bigint; race: bigint; attribute: bigint;
  name: string | null; desc: string | null;
};

const cache = new Map<string, { signature: string; cards: Map<number, DeckCardInfo> }>();

function loadCards(dataDirectory: string): Map<number, DeckCardInfo> | null {
  const path = resolve(dataDirectory, "cards.cdb");
  let stat;
  try { stat = statSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      cache.delete(path);
      return null;
    }
    throw error;
  }
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = cache.get(path);
  if (cached?.signature === signature) return cached.cards;

  // Read only the prepared, merged CDB: release files and their ordering are
  // owned by duel:prepare. Web does not need a core, scripts or strings.conf.
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const cards = new Map<number, DeckCardInfo>();
  try {
    const rows = db.prepare(`select d.id, d.ot, d.alias, d.setcode, d.type, d.atk, d.def,
      d.level, d.race, d.attribute, t.name, t.desc from datas d join texts t using (id)`)
      .safeIntegers(true).all() as EngineRow[];
    for (const row of rows) {
      const code = Number(row.id), type = Number(row.type), level = Number(row.level);
      const setcodes: number[] = [];
      for (let shift = 0n; shift < 64n; shift += 16n) {
        const setcode = Number((row.setcode >> shift) & 0xffffn);
        if (setcode) setcodes.push(setcode);
      }
      cards.set(code, {
        code, name: row.name ?? `Card ${code}`, description: row.desc ?? "",
        type, attack: Number(row.atk), defense: type & CARD_TYPE_BITS.link ? 0 : Number(row.def),
        level: level & 0xff, attribute: Number(row.attribute),
        race: CARD_RACES.filter(race => (row.race & BigInt(race.bit)) !== 0n).map(race => race.label).join("/") || "unknown",
        alias: Number(row.alias), setcodes, lscale: (level >> 24) & 0xff, rscale: (level >> 16) & 0xff,
        arrows: type & CARD_TYPE_BITS.link ? Number(row.def) : 0, ot: Number(row.ot),
      });
    }
  } finally { db.close(); }
  const familyCounts = new Map<number, number>();
  for (const card of cards.values()) {
    card.canonicalPasscode = canonicalCardCode(card.code, cards);
    familyCounts.set(card.canonicalPasscode, (familyCounts.get(card.canonicalPasscode) ?? 0) + 1);
  }
  for (const card of cards.values()) card.altArtCount = familyCounts.get(card.canonicalPasscode!)! - 1;
  cache.set(path, { signature, cards });
  return cards;
}

/** Exact metadata for previews, independent of YGOPRODeck availability or TCG release dates.
 * Cached catalog text wins when present; engine texts.name/desc fill missing fields.
 * Null means this process has no prepared bundle, so a caller can ask the duel host.
 */
export function readEngineCardInfo(
  codes: number[],
  dataDirectory: string,
  catalog?: Pick<CardCatalogService, "findByIds">,
): { cards: DeckCardInfo[]; missing: number[] } | null {
  const engine = loadCards(dataDirectory);
  if (!engine) return null;
  const ids = [...new Set(codes)];
  const cards: DeckCardInfo[] = [], missing: number[] = [];
  for (const code of ids) {
    const card = engine.get(code);
    if (!card) { missing.push(code); continue; }
    cards.push(card);
  }
  return { cards: withCatalogCardText(cards, catalog), missing };
}

/** Prefer cached name/text without changing engine or live metadata. Canonical
 * passcodes from the prepared bundle also resolve catalog-only artwork mains.
 */
export function withCatalogCardText<T extends DuelCardInfo>(
  cards: T[],
  catalog?: Pick<CardCatalogService, "findByIds">,
): T[] {
  const ids = [...new Set(cards.flatMap(card => [card.code, card.canonicalPasscode ?? card.code]))];
  const catalogCards = new Map(catalog?.findByIds(ids).map(card => [card.ygoprodeckId, card]));
  return cards.map(card => {
    const cached = catalogCards.get(card.code) ?? catalogCards.get(card.canonicalPasscode ?? card.code);
    return {
      ...card,
      name: cached?.name?.trim() && cached.name.trim() !== `Card ${card.code}` ? cached.name : card.name,
      description: cached?.effectText?.trim() ? cached.effectText : card.description,
    };
  });
}
